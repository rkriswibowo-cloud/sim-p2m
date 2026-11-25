package iam

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"math/big"
	"mime"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

type docxMeta struct {
	Proposal        proposal
	InstitutionName string
	FieldName       string
	FundingSource   string
	FiscalYear      int
	OwnerEmail      string
	OwnerCode       string
	OwnerUnit       string
	Lecturers       map[int64]personDetail
	Students        map[int64]personDetail
}

type personDetail struct {
	ID   int64
	Name string
	Code string
	Unit string
}

func (s service) loadProposalDocxMeta(ctx context.Context, a actor, id int64) (docxMeta, error) {
	var meta docxMeta
	meta.Lecturers = map[int64]personDetail{}
	meta.Students = map[int64]personDetail{}

	row := s.db.QueryRowContext(ctx, proposalSelect+" WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=? AND p.status<>'archived'", a.tenant, a.ID, id)
	prop, err := readProposal(row)
	if err != nil {
		return meta, err
	}
	meta.Proposal = prop

	err = s.db.QueryRowContext(ctx, `SELECT i.name, COALESCE(rf.name,'-'), COALESCE(fs.name,'-'), g.fiscal_year, u.email
 FROM research_proposals p
 JOIN institutions i ON i.id=p.institution_id
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 JOIN users u ON u.id=p.owner_user_id
 LEFT JOIN research_fields rf ON rf.institution_id=p.institution_id AND rf.id=p.research_field_id
 LEFT JOIN funding_sources fs ON fs.institution_id=v.institution_id AND fs.id=v.funding_source_id
 WHERE p.institution_id=? AND p.id=?`, a.tenant, id).Scan(&meta.InstitutionName, &meta.FieldName, &meta.FundingSource, &meta.FiscalYear, &meta.OwnerEmail)
	if err != nil {
		return meta, err
	}

	_ = s.db.QueryRowContext(ctx, `SELECT l.code, COALESCE(sp.name,'-')
 FROM lecturers l
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 WHERE l.institution_id=? AND l.email=? LIMIT 1`, a.tenant, meta.OwnerEmail).Scan(&meta.OwnerCode, &meta.OwnerUnit)

	if len(prop.Data.Team) > 0 {
		lRows, err := s.db.QueryContext(ctx, `SELECT l.id, l.name, l.code, COALESCE(sp.name,'-')
 FROM lecturers l LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 WHERE l.institution_id=?`, a.tenant)
		if err == nil {
			defer lRows.Close()
			for lRows.Next() {
				var d personDetail
				if lRows.Scan(&d.ID, &d.Name, &d.Code, &d.Unit) == nil {
					meta.Lecturers[d.ID] = d
				}
			}
		}
	}
	if len(prop.Data.Students) > 0 {
		sRows, err := s.db.QueryContext(ctx, `SELECT st.id, st.name, st.code, COALESCE(sp.name,'-')
 FROM students st LEFT JOIN study_programs sp ON sp.institution_id=st.institution_id AND sp.id=st.parent_id
 WHERE st.institution_id=?`, a.tenant)
		if err == nil {
			defer sRows.Close()
			for sRows.Next() {
				var d personDetail
				if sRows.Scan(&d.ID, &d.Name, &d.Code, &d.Unit) == nil {
					meta.Students[d.ID] = d
				}
			}
		}
	}
	return meta, nil
}

func xmlEsc(s string) string {
	var b bytes.Buffer
	for _, r := range s {
		switch r {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '"':
			b.WriteString("&quot;")
		case '\'':
			b.WriteString("&apos;")
		case '\t':
			b.WriteString("    ")
		default:
			if r >= 0x20 || r == '\n' {
				b.WriteRune(r)
			}
		}
	}
	return b.String()
}

func docxParagraph(text string, bold bool, sizeHalfPt int, align string, spaceAfter int) string {
	jc := ""
	if align != "" {
		jc = fmt.Sprintf(`<w:jc w:val="%s"/>`, align)
	}
	bTag := ""
	if bold {
		bTag = `<w:b/>`
	}
	if sizeHalfPt == 0 {
		sizeHalfPt = 22 // 11pt
	}
	return fmt.Sprintf(`<w:p><w:pPr>%s<w:spacing w:after="%d" w:line="276" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/>%s<w:sz w:val="%d"/><w:szCs w:val="%d"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>`,
		jc, spaceAfter, bTag, sizeHalfPt, sizeHalfPt, xmlEsc(text))
}

func docxRichParagraphs(rawHTML string) string {
	clean := strings.ReplaceAll(rawHTML, "\r\n", "\n")
	clean = strings.ReplaceAll(clean, "<li>", "\n• ")
	clean = strings.ReplaceAll(clean, "<LI>", "\n• ")
	clean = stripHTMLTags(clean)
	if clean == "" {
		return docxParagraph("-", false, 22, "both", 120)
	}
	var b strings.Builder
	for _, line := range strings.Split(clean, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		b.WriteString(docxParagraph(trimmed, false, 22, "both", 120))
	}
	if b.Len() == 0 {
		return docxParagraph("-", false, 22, "both", 120)
	}
	return b.String()
}

func docxPageBreak() string {
	return `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`
}

func docxTable(headers []string, rows [][]string, colWidths []int) string {
	var b strings.Builder
	b.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>`)
	for _, side := range []string{"top", "left", "bottom", "right", "insideH", "insideV"} {
		b.WriteString(fmt.Sprintf(`<w:%s w:val="single" w:sz="4" w:space="0" w:color="333333"/>`, side))
	}
	b.WriteString(`</w:tblBorders></w:tblPr>`)
	writeRow := func(cells []string, isHeader bool) {
		b.WriteString(`<w:tr>`)
		for i, cell := range cells {
			w := 1800
			if i < len(colWidths) {
				w = colWidths[i]
			}
			shd := ""
			if isHeader {
				shd = `<w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/>`
			}
			b.WriteString(fmt.Sprintf(`<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/>%s<w:tcMar><w:top w:w="60" w:type="dxa"/><w:bottom w:w="60" w:type="dxa"/><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tcMar></w:tcPr>`, w, shd))
			b.WriteString(docxParagraph(cell, isHeader, 20, "left", 40))
			b.WriteString(`</w:tc>`)
		}
		b.WriteString(`</w:tr>`)
	}
	writeRow(headers, true)
	for _, r := range rows {
		writeRow(r, false)
	}
	b.WriteString(`</w:tbl><w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`)
	return b.String()
}

func buildDocxBytes(bodyXML string) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	files := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
		"word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:body>` + bodyXML + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1418" w:right="1418" w:bottom="1418" w:left="1418"/></w:sectPr>
 </w:body>
</w:document>`,
	}

	for name, content := range files {
		w, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err := w.Write([]byte(content)); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func formatRupiahID(amountStr string) string {
	val, err := strconv.ParseInt(amountStr, 10, 64)
	if err != nil {
		return "Rp " + amountStr
	}
	s := strconv.FormatInt(val, 10)
	var out []byte
	for i, c := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			out = append(out, '.')
		}
		out = append(out, byte(c))
	}
	return "Rp " + string(out)
}

func formatSubtotalRupiah(qtyStr, priceStr string) string {
	q, ok1 := new(big.Rat).SetString(qtyStr)
	p, ok2 := new(big.Rat).SetString(priceStr)
	if !ok1 || !ok2 {
		return "-"
	}
	sub := new(big.Rat).Mul(q, p)
	sub.Add(sub, big.NewRat(1, 2))
	i := new(big.Int).Quo(sub.Num(), sub.Denom())
	return formatRupiahID(i.String())
}

var nonSlugPattern = regexp.MustCompile(`[^a-zA-Z0-9_-]+`)

func safeDocxFilename(prefix string, id int64) string {
	return fmt.Sprintf("%s_%d.docx", nonSlugPattern.ReplaceAllString(prefix, "_"), id)
}

func (s service) exportProposalDocx(c *gin.Context, a actor) {
	id := target(c)
	if id < 1 {
		c.Status(400)
		return
	}
	meta, err := s.loadProposalDocxMeta(c.Request.Context(), a, id)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	p := meta.Proposal
	d := p.Data

	var body strings.Builder
	// Cover
	body.WriteString(docxParagraph("USULAN PENELITIAN", true, 32, "center", 160))
	body.WriteString(docxParagraph(strings.ToUpper(p.Scheme), true, 26, "center", 480))
	body.WriteString(docxParagraph(p.Title, true, 28, "center", 720))
	body.WriteString(docxParagraph("TIM PENGUSUL", true, 22, "center", 160))
	ownerLabel := p.Owner
	if meta.OwnerCode != "" {
		ownerLabel += " (" + meta.OwnerCode + ")"
	}
	body.WriteString(docxParagraph("Ketua: "+ownerLabel, false, 22, "center", 100))
	for _, m := range d.Team {
		name := fmt.Sprintf("Dosen #%d", m.ID)
		if info, ok := meta.Lecturers[m.ID]; ok {
			name = info.Name + " (" + info.Code + ")"
		}
		body.WriteString(docxParagraph("Anggota: "+name, false, 22, "center", 80))
	}
	body.WriteString(docxParagraph("", false, 22, "center", 720))
	body.WriteString(docxParagraph(strings.ToUpper(meta.InstitutionName), true, 24, "center", 100))
	body.WriteString(docxParagraph(fmt.Sprintf("TAHUN %d", meta.FiscalYear), true, 24, "center", 200))
	body.WriteString(docxPageBreak())

	// Identitas
	body.WriteString(docxParagraph("IDENTITAS DAN URAIAN UMUM", true, 24, "left", 180))
	identRows := [][]string{
		{"Judul Penelitian", p.Title},
		{"Skema / Periode", p.Scheme + " (" + p.Period + ")"},
		{"Bidang Riset", meta.FieldName},
		{"Objek & Lokasi", d.Object + " / " + d.Location},
		{"Jangka Waktu", d.Starts + " s.d. " + d.Ends},
		{"Instansi Mitra", d.Partner + " (" + d.Contribution + ")"},
		{"Temuan Ditargetkan", d.Findings},
		{"Jurnal Sasaran", d.Journal},
		{"Sumber Dana", meta.FundingSource},
		{"Total Usulan Biaya", formatRupiahID(p.Budget)},
	}
	body.WriteString(docxTable([]string{"Komponen", "Keterangan"}, identRows, []int{3000, 6000}))

	// Ringkasan & Narasi
	body.WriteString(docxParagraph("RINGKASAN", true, 24, "left", 140))
	body.WriteString(docxRichParagraphs(d.Summary))
	body.WriteString(docxParagraph("Kata Kunci: "+strings.Join(d.Keywords, ", "), true, 22, "left", 80))
	if d.SDGKeywords != "" {
		body.WriteString(docxParagraph("Kata Kunci SDGs: "+d.SDGKeywords, false, 22, "left", 160))
	}

	body.WriteString(docxParagraph("A. PENDAHULUAN", true, 24, "left", 140))
	body.WriteString(docxRichParagraphs(d.Introduction))

	body.WriteString(docxParagraph("B. TINJAUAN PUSTAKA", true, 24, "left", 140))
	body.WriteString(docxRichParagraphs(d.Literature))

	body.WriteString(docxParagraph("C. ROADMAP PENELITIAN", true, 24, "left", 140))
	body.WriteString(docxRichParagraphs(d.Roadmap))

	body.WriteString(docxParagraph("D. METODE PENELITIAN", true, 24, "left", 140))
	body.WriteString(docxRichParagraphs(d.Method))

	body.WriteString(docxParagraph("E. HASIL YANG DIHARAPKAN & TARGET LUARAN", true, 24, "left", 140))
	body.WriteString(docxRichParagraphs(d.Expected))
	if len(d.Outputs) > 0 {
		outRows := [][]string{}
		for i, o := range d.Outputs {
			outRows = append(outRows, []string{strconv.Itoa(i + 1), o.Kind, o.Status, strconv.Itoa(o.Year)})
		}
		body.WriteString(docxTable([]string{"No", "Jenis Luaran", "Status Target", "Tahun"}, outRows, []int{800, 4200, 2600, 1400}))
	}

	body.WriteString(docxParagraph("F. RENCANA ANGGARAN BIAYA (RAB)", true, 24, "left", 140))
	if len(d.Costs) > 0 {
		costRows := [][]string{}
		for _, cost := range d.Costs {
			costRows = append(costRows, []string{
				cost.Category,
				cost.Item + " (" + cost.Reason + ")",
				cost.Quantity + " " + cost.Unit,
				formatRupiahID(cost.Price),
				formatSubtotalRupiah(cost.Quantity, cost.Price),
			})
		}
		costRows = append(costRows, []string{"", "TOTAL ANGGARAN DIUSULKAN", "", "", formatRupiahID(p.Budget)})
		body.WriteString(docxTable([]string{"Kategori", "Item & Justifikasi", "Volume", "Harga Satuan", "Subtotal"}, costRows, []int{1700, 3100, 1200, 1500, 1500}))
	}

	body.WriteString(docxParagraph("G. JADWAL KEGIATAN", true, 24, "left", 140))
	if len(d.Schedule) > 0 {
		schRows := [][]string{}
		for i, sch := range d.Schedule {
			schRows = append(schRows, []string{
				strconv.Itoa(i + 1),
				sch.Name,
				sch.Output,
				sch.Person,
				fmt.Sprintf("Bulan %d - %d", sch.From, sch.To),
			})
		}
		body.WriteString(docxTable([]string{"No", "Tahapan", "Luaran", "Penanggung Jawab", "Waktu"}, schRows, []int{700, 2600, 2200, 2000, 1500}))
	}

	body.WriteString(docxParagraph("H. DAFTAR PUSTAKA", true, 24, "left", 140))
	body.WriteString(docxRichParagraphs(d.References))

	rawDocx, err := buildDocxBytes(body.String())
	if err != nil {
		c.Status(500)
		return
	}
	filename := safeDocxFilename("Proposal_Penelitian", p.ID)
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", rawDocx)
}

func (s service) exportStudentLetterDocx(c *gin.Context, a actor) {
	id := target(c)
	if id < 1 {
		c.Status(400)
		return
	}
	meta, err := s.loadProposalDocxMeta(c.Request.Context(), a, id)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	p := meta.Proposal
	d := p.Data

	var body strings.Builder
	body.WriteString(docxParagraph("SURAT PERNYATAAN KETERLIBATAN MAHASISWA", true, 26, "center", 60))
	body.WriteString(docxParagraph("DALAM PENELITIAN DOSEN", true, 26, "center", 240))

	body.WriteString(docxParagraph("Yang bertanda tangan di bawah ini:", false, 22, "left", 120))
	idRows := [][]string{
		{"Nama Ketua Peneliti", p.Owner},
		{"NIDN / NUPTK / Kode", emptyDash(meta.OwnerCode)},
		{"Program Studi / Unit", emptyDash(meta.OwnerUnit)},
		{"Institusi", meta.InstitutionName},
	}
	body.WriteString(docxTable([]string{"Identitas", "Keterangan"}, idRows, []int{3000, 6000}))

	body.WriteString(docxParagraph("Menyatakan dengan sesungguhnya bahwa mahasiswa di bawah ini dilibatkan dalam pelaksanaan penelitian dengan rincian:", false, 22, "both", 120))

	propRows := [][]string{
		{"Judul Penelitian", p.Title},
		{"Skema Penelitian", p.Scheme},
		{"Sumber Dana", meta.FundingSource},
		{"Tahun Anggaran", strconv.Itoa(meta.FiscalYear)},
	}
	body.WriteString(docxTable([]string{"Komponen", "Keterangan"}, propRows, []int{3000, 6000}))

	if len(d.Students) > 0 {
		mhsRows := [][]string{}
		taRows := [][]string{}
		for i, st := range d.Students {
			name := fmt.Sprintf("Mahasiswa #%d", st.ID)
			code := "-"
			if info, ok := meta.Students[st.ID]; ok {
				name = info.Name
				code = info.Code
			}
			mhsRows = append(mhsRows, []string{strconv.Itoa(i + 1), name, code, st.Activity})
			taRows = append(taRows, []string{strconv.Itoa(i + 1), name, code, emptyDash(st.Thesis), ""})
		}
		body.WriteString(docxParagraph("Daftar Mahasiswa dan Bentuk Keterlibatan:", true, 22, "left", 100))
		body.WriteString(docxTable([]string{"No", "Nama Mahasiswa", "NIM", "Bentuk Keterlibatan"}, mhsRows, []int{700, 2800, 1800, 3700}))

		body.WriteString(docxParagraph("Daftar Rencana Tugas Akhir dan Tanda Tangan Mahasiswa:", true, 22, "left", 100))
		body.WriteString(docxTable([]string{"No", "Nama Mahasiswa", "NIM", "Judul Tugas Akhir", "Tanda Tangan"}, taRows, []int{600, 2200, 1500, 3100, 1600}))
	} else {
		body.WriteString(docxParagraph("(Belum ada mahasiswa yang ditambahkan pada tim penelitian ini.)", false, 22, "left", 160))
	}

	body.WriteString(docxParagraph("Demikian surat pernyataan ini dibuat untuk digunakan sebagaimana mestinya.", false, 22, "both", 240))
	today := time.Now().Format("02 January 2006")
	signRows := [][]string{
		{"Mengetahui,\nPejabat LPPM " + meta.InstitutionName + "\n\n\n\n(........................................)",
			meta.InstitutionName + ", " + today + "\nKetua Peneliti,\n\n\n\n" + p.Owner},
	}
	body.WriteString(docxTable([]string{"Pihak LPPM", "Ketua Peneliti"}, signRows, []int{4500, 4500}))

	rawDocx, err := buildDocxBytes(body.String())
	if err != nil {
		c.Status(500)
		return
	}
	filename := safeDocxFilename("Surat_Keterlibatan_Mahasiswa", p.ID)
	c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
	c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": filename}))
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", rawDocx)
}

func emptyDash(s string) string {
	if strings.TrimSpace(s) == "" {
		return "-"
	}
	return s
}

// Keep unused imports guard if any
var _ = json.Marshal
var _ = html.EscapeString

