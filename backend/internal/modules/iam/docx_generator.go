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
	"image"
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
	OwnerNuptk      string
	OwnerPhone      string
	OwnerUnit       string
	OwnerFaculty    string
	Lecturers       map[int64]personDetail
	Students        map[int64]personDetail
}

type personDetail struct {
	ID    int64
	Name  string
	Code  string
	NUPTK string
	Unit  string
	Phone string
	Email string
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

	_ = s.db.QueryRowContext(ctx, `SELECT l.code, COALESCE(NULLIF(l.nuptk,''),l.code), COALESCE(sp.name,'-'), COALESCE(f.name,'-'), COALESCE(l.phone,'-')
 FROM lecturers l
 LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 LEFT JOIN faculties f ON f.institution_id=sp.institution_id AND f.id=sp.parent_id
 WHERE l.institution_id=? AND (l.user_id=? OR (l.user_id IS NULL AND l.email=?)) LIMIT 1`, a.tenant, a.ID, meta.OwnerEmail).Scan(&meta.OwnerCode, &meta.OwnerNuptk, &meta.OwnerUnit, &meta.OwnerFaculty, &meta.OwnerPhone)

	if len(prop.Data.Team) > 0 {
		lRows, err := s.db.QueryContext(ctx, `SELECT l.id, l.name, l.code, COALESCE(NULLIF(l.nuptk,''),l.code), COALESCE(sp.name,'-'), COALESCE(l.phone,'-'), COALESCE(l.email,'-')
 FROM lecturers l LEFT JOIN study_programs sp ON sp.institution_id=l.institution_id AND sp.id=l.parent_id
 WHERE l.institution_id=?`, a.tenant)
		if err == nil {
			defer lRows.Close()
			for lRows.Next() {
				var d personDetail
				if lRows.Scan(&d.ID, &d.Name, &d.Code, &d.NUPTK, &d.Unit, &d.Phone, &d.Email) == nil {
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
	return fmt.Sprintf(`<w:p><w:pPr><w:spacing w:after="%d" w:line="276" w:lineRule="auto"/>%s</w:pPr><w:r><w:rPr><w:rFonts w:ascii="Tahoma" w:hAnsi="Tahoma" w:cs="Tahoma"/>%s<w:sz w:val="%d"/><w:szCs w:val="%d"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r></w:p>`,
		spaceAfter, jc, bTag, sizeHalfPt, sizeHalfPt, xmlEsc(text))
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

func docxHeading(text, align string, pageStart bool) string {
	controls := `<w:keepNext/>`
	if pageStart {
		controls += `<w:pageBreakBefore/>`
	}
	return strings.Replace(docxParagraph(text, true, 24, align, 140), "<w:pPr>", "<w:pPr>"+controls, 1)
}

func docxTable(headers []string, rows [][]string, colWidths []int) string {
	var b strings.Builder
	b.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>`)
	for _, side := range []string{"top", "left", "bottom", "right", "insideH", "insideV"} {
		b.WriteString(fmt.Sprintf(`<w:%s w:val="single" w:sz="4" w:space="0" w:color="333333"/>`, side))
	}
	b.WriteString(`</w:tblBorders></w:tblPr><w:tblGrid>`)
	for _, width := range colWidths {
		fmt.Fprintf(&b, `<w:gridCol w:w="%d"/>`, width)
	}
	b.WriteString(`</w:tblGrid>`)
	writeRow := func(cells []string, isHeader bool) {
		b.WriteString(`<w:tr><w:trPr><w:cantSplit/>`)
		if isHeader {
			b.WriteString(`<w:tblHeader/>`)
		}
		b.WriteString(`</w:trPr>`)
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

func docxBoxedSection(title, guide, contentXML string) string {
	var b strings.Builder
	b.WriteString(`<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>`)
	for _, side := range []string{"top", "left", "bottom", "right", "insideH", "insideV"} {
		b.WriteString(fmt.Sprintf(`<w:%s w:val="single" w:sz="6" w:space="0" w:color="000000"/>`, side))
	}
	b.WriteString(`</w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="9000"/></w:tblGrid>`)
	b.WriteString(`<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="8EAADB"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>`)
	b.WriteString(strings.Replace(docxParagraph(title, true, 22, "left", 40), "<w:pPr>", "<w:pPr><w:keepNext/>", 1))
	b.WriteString(`</w:tc></w:tr>`)
	b.WriteString(`<w:tr><w:trPr><w:cantSplit/></w:trPr><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="BDD0E9"/><w:tcMar><w:top w:w="80" w:type="dxa"/><w:bottom w:w="80" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>`)
	b.WriteString(docxParagraph(guide, false, 20, "left", 40))
	b.WriteString(`</w:tc></w:tr>`)
	b.WriteString(`<w:tr><w:tc><w:tcPr><w:tcW w:w="9000" w:type="dxa"/><w:tcMar><w:top w:w="100" w:type="dxa"/><w:bottom w:w="100" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tcMar></w:tcPr>`)
	b.WriteString(contentXML)
	b.WriteString(`</w:tc></w:tr></w:tbl><w:p><w:pPr><w:spacing w:after="100"/></w:pPr></w:p>`)
	return b.String()
}

type docxDiagram struct {
	Index         int
	Label         string
	Extension     string
	Content       []byte
	Width, Height int
}

func (d docxDiagram) drawing() string {
	name := html.EscapeString(d.Label)
	return fmt.Sprintf(`<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing>
 <wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
 <wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="%s"/>
 <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
 <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
 <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
 <pic:nvPicPr><pic:cNvPr id="0" name="%s"/><pic:cNvPicPr/></pic:nvPicPr>
 <pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="rIdImage%d"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>
 <pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr>
 </pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
		d.Width, d.Height, d.Index, name, name, d.Index, d.Width, d.Height) + docxParagraph(d.Label, false, 20, "center", 150)
}

func (s service) proposalDocxDiagrams(ctx context.Context, proposalID int64) (map[string]docxDiagram, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT kind,content FROM research_proposal_images WHERE proposal_id=? AND kind IN ('roadmap','method') ORDER BY kind`, proposalID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make(map[string]docxDiagram)
	for rows.Next() {
		var kind string
		var content []byte
		if err := rows.Scan(&kind, &content); err != nil {
			return nil, err
		}
		cfg, format, err := image.DecodeConfig(bytes.NewReader(content))
		if err != nil || cfg.Width < 1 || cfg.Height < 1 || (format != "jpeg" && format != "png") {
			continue
		}
		width, height := 5400000, 5400000*int64(cfg.Height)/int64(cfg.Width)
		if height > 4200000 {
			width, height = int(4200000*int64(cfg.Width)/int64(cfg.Height)), 4200000
		}
		label := "Diagram metode penelitian"
		if kind == "roadmap" {
			label = "Diagram peta jalan penelitian"
		}
		items[kind] = docxDiagram{Index: len(items) + 1, Label: label, Extension: format, Content: content, Width: max(1, width), Height: max(1, int(height))}
	}
	return items, rows.Err()
}

func buildDocxBytes(bodyXML string, diagrams ...docxDiagram) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	files := map[string]string{
		"[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Default Extension="jpeg" ContentType="image/jpeg"/>
 <Default Extension="png" ContentType="image/png"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
		"_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
		"word/document.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:body>` + bodyXML + `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1701" w:right="1701" w:bottom="1701" w:left="2268"/></w:sectPr>
 </w:body>
</w:document>`,
	}
	if len(diagrams) > 0 {
		var rels strings.Builder
		rels.WriteString(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
		for _, diagram := range diagrams {
			path := fmt.Sprintf("media/diagram%d.%s", diagram.Index, diagram.Extension)
			fmt.Fprintf(&rels, `<Relationship Id="rIdImage%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="%s"/>`, diagram.Index, path)
			files["word/"+path] = string(diagram.Content)
		}
		files["word/_rels/document.xml.rels"] = rels.String() + "</Relationships>"
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

func formatIndonesianDate(t time.Time) string {
	months := [...]string{"", "Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"}
	loc, err := time.LoadLocation("Asia/Jakarta")
	if err == nil {
		t = t.In(loc)
	}
	return fmt.Sprintf("%d %s %d", t.Day(), months[int(t.Month())], t.Year())
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
	diagrams, err := s.proposalDocxDiagrams(c.Request.Context(), p.ID)
	if err != nil {
		c.Status(503)
		return
	}
	embedded := []docxDiagram{}

	var body strings.Builder
	// Cover
	body.WriteString(docxParagraph("", false, 22, "center", 1200))
	body.WriteString(docxParagraph("PROPOSAL PENELITIAN", true, 32, "center", 360))
	body.WriteString(docxParagraph(p.Title, true, 26, "center", 360))
	ownerCover := p.Owner
	if meta.OwnerNuptk != "" {
		ownerCover = meta.OwnerNuptk + " " + p.Owner
	}
	body.WriteString(docxParagraph(ownerCover, true, 22, "center", 1800))
	if meta.OwnerUnit != "" && meta.OwnerUnit != "-" {
		body.WriteString(docxParagraph(meta.OwnerUnit, true, 22, "center", 80))
	}
	if meta.OwnerFaculty != "" && meta.OwnerFaculty != "-" {
		body.WriteString(docxParagraph(meta.OwnerFaculty, true, 22, "center", 80))
	}
	body.WriteString(docxParagraph(meta.InstitutionName, true, 22, "center", 80))
	body.WriteString(docxParagraph(fmt.Sprintf("%d", meta.FiscalYear), true, 22, "center", 200))
	ownerLabel := p.Owner
	if meta.OwnerCode != "" {
		ownerLabel += " (" + meta.OwnerCode + ")"
	}

	body.WriteString(docxHeading("HALAMAN PENGESAHAN", "center", true))
	body.WriteString(docxParagraph("PROPOSAL PENELITIAN", true, 24, "center", 240))
	romanIdx := []string{"I", "II", "III", "IV", "V"}
	approvalRows := [][]string{
		{"Judul Penelitian", ": " + p.Title},
		{"Bidang Riset", ": " + meta.FieldName},
		{"Skema Riset", ": " + p.Scheme},
		{"Dana yang diajukan", ": " + formatRupiahID(p.Budget)},
		{"Ketua Peneliti", ""},
		{"  Nama", ": " + p.Owner},
		{"  NIDN/NUPTK", ": " + meta.OwnerNuptk},
		{"  Program Studi", ": " + meta.OwnerUnit},
		{"  Nomor HP", ": " + meta.OwnerPhone},
		{"  Email", ": " + meta.OwnerEmail},
	}
	for i, member := range d.Team {
		idxLabel := fmt.Sprintf("%d", i+1)
		if i < len(romanIdx) {
			idxLabel = romanIdx[i]
		}
		info, ok := meta.Lecturers[member.ID]
		name, nuptk, unit, phone, email := fmt.Sprintf("Dosen #%d", member.ID), "-", "-", "-", "-"
		if ok {
			name = info.Name
			if info.NUPTK != "" {
				nuptk = info.NUPTK
			} else if info.Code != "" {
				nuptk = info.Code
			}
			if info.Unit != "" {
				unit = info.Unit
			}
			if info.Phone != "" {
				phone = info.Phone
			}
			if info.Email != "" {
				email = info.Email
			}
		}
		approvalRows = append(approvalRows,
			[]string{"Anggota Peneliti " + idxLabel, ""},
			[]string{"  Nama", ": " + name},
			[]string{"  NIDN/NUPTK", ": " + nuptk},
			[]string{"  Program Studi", ": " + unit},
			[]string{"  Nomor HP", ": " + phone},
			[]string{"  Email", ": " + email},
		)
	}
	approvalRows = append(approvalRows, []string{"Jumlah Mahasiswa yang dilibatkan", fmt.Sprintf(": %d Orang", len(d.Students))})
	outputList := "-"
	if len(d.Outputs) > 0 {
		parts := []string{}
		for _, o := range d.Outputs {
			parts = append(parts, fmt.Sprintf("%s (%s, %d)", o.Kind, o.Status, o.Year))
		}
		outputList = strings.Join(parts, "; ")
	}
	approvalRows = append(approvalRows, []string{"Luaran yang dijanjikan", ": " + outputList})
	body.WriteString(docxTable([]string{"Komponen", "Keterangan"}, approvalRows, []int{3200, 5800}))

	body.WriteString(docxParagraph("Sidoarjo, "+formatIndonesianDate(time.Now()), false, 22, "right", 160))
	body.WriteString(docxTable([]string{"Menyetujui,\nKetua Program Studi", "Ketua Peneliti"}, [][]string{
		{"\n\n\n____________________________", "\n\n\n" + p.Owner},
		{"NUPTK.", "NUPTK. " + meta.OwnerNuptk},
	}, []int{4500, 4500}))
	body.WriteString(docxTable([]string{"Mengetahui,\nDekan Fakultas " + meta.OwnerFaculty, "Disahkan,\nPlt. Kepala LPPM"}, [][]string{
		{"\n\n\n____________________________", "\n\n\n____________________________"},
		{"NUPTK.", "NUPTK."},
	}, []int{4500, 4500}))

	// Identitas
	body.WriteString(docxHeading("IDENTITAS DAN URAIAN UMUM", "center", true))
	body.WriteString(docxParagraph("1. Judul Penelitian", true, 22, "left", 60))
	body.WriteString(docxParagraph(p.Title, false, 22, "left", 140))

	body.WriteString(docxParagraph("2. Tim Peneliti", true, 22, "left", 80))
	teamRows := [][]string{
		{"1", p.Owner + " (Ketua Peneliti)", meta.OwnerNuptk, meta.OwnerUnit, meta.FieldName, "-"},
	}
	for i, member := range d.Team {
		info, ok := meta.Lecturers[member.ID]
		name, nuptk, unit := fmt.Sprintf("Dosen #%d", member.ID), "-", "-"
		if ok {
			name = info.Name
			if info.NUPTK != "" {
				nuptk = info.NUPTK
			} else if info.Code != "" {
				nuptk = info.Code
			}
			if info.Unit != "" {
				unit = info.Unit
			}
		}
		hours := "-"
		if member.Hours > 0 {
			hours = fmt.Sprintf("%d", member.Hours)
		}
		teamRows = append(teamRows, []string{fmt.Sprintf("%d", i+2), name, nuptk, unit, member.Expertise, hours})
	}
	body.WriteString(docxTable([]string{"No", "Nama", "NUPTK", "Program Studi", "Bidang Keahlian", "Alokasi waktu (Jam/minggu)"}, teamRows, []int{600, 2200, 1500, 1700, 1700, 1300}))

	body.WriteString(docxParagraph("3. Objek Penelitian (jenis material yang diteliti dan segi penelitian)", true, 22, "left", 60))
	body.WriteString(docxParagraph(d.Object, false, 22, "left", 120))
	body.WriteString(docxParagraph("4. Masa Pelaksanaan", true, 22, "left", 60))
	body.WriteString(docxParagraph("Mulai : "+d.Starts, false, 22, "left", 40))
	body.WriteString(docxParagraph("Berakhir : "+d.Ends, false, 22, "left", 120))
	body.WriteString(docxParagraph("5. Usulan Biaya :", true, 22, "left", 60))
	body.WriteString(docxParagraph(formatRupiahID(p.Budget), false, 22, "left", 120))
	body.WriteString(docxParagraph("6. Lokasi Penelitian :", true, 22, "left", 60))
	body.WriteString(docxParagraph(d.Location, false, 22, "left", 120))
	body.WriteString(docxParagraph("7. Instansi lain yang terlibat (jika ada, sebutkan dan uraikan kontribusinya)", true, 22, "left", 60))
	partnerText := "-"
	if d.Partner != "" {
		partnerText = d.Partner
		if d.Contribution != "" {
			partnerText += " (" + d.Contribution + ")"
		}
	}
	body.WriteString(docxParagraph(partnerText, false, 22, "left", 120))
	body.WriteString(docxParagraph("8. Temuan yang ditargetkan", true, 22, "left", 60))
	body.WriteString(docxParagraph(d.Findings, false, 22, "left", 120))
	body.WriteString(docxParagraph("9. Jurnal Ilmiah yang menjadi sasaran publikasi", true, 22, "left", 60))
	body.WriteString(docxParagraph(d.Journal, false, 22, "left", 160))

	body.WriteString(docxHeading(fmt.Sprintf("PROPOSAL PENELITIAN - %s TAHUN %d/%d", strings.ToUpper(meta.InstitutionName), meta.FiscalYear, meta.FiscalYear+1), "right", true))

	var secA strings.Builder
	secA.WriteString(docxRichParagraphs(d.Roadmap))
	if diagram, ok := diagrams["roadmap"]; ok {
		secA.WriteString(diagram.drawing())
		embedded = append(embedded, diagram)
	}
	body.WriteString(docxBoxedSection(
		"A. PETA JALAN PENELITIAN (ROAD MAP)",
		"Tuliskan peta jalan penelitian dari tahapan yang telah dicapai, tahapan yang akan dilakukan selama jangka waktu penelitian, dan tahapan yang direncanakan. Bagan dan road map dibuat dalam bentuk JPG/PNG yang kemudian disisipkan dalam isian ini.",
		secA.String(),
	))

	body.WriteString(docxBoxedSection(
		"B. RINGKASAN",
		"Ringkasan dijelaskan tidak lebih dari 1 halaman dengan font Tahoma ukuran 11 spasi 1,15 yang berisi uraian latar belakang penelitian, tujuan dan tahapan metode penelitian, luaran yang ditargetkan.",
		docxRichParagraphs(d.Summary),
	))

	var secC strings.Builder
	kw := strings.Join(d.Keywords, ", ")
	if kw == "" {
		kw = "-"
	}
	secC.WriteString(docxParagraph(kw, false, 22, "left", 60))
	if d.SDGKeywords != "" {
		secC.WriteString(docxParagraph("Kata Kunci SDGs: "+d.SDGKeywords, false, 22, "left", 60))
	}
	body.WriteString(docxBoxedSection(
		"C. KATA KUNCI",
		"Cantumkan pula lima kata kunci (key words) yang paling dominan dan ditambah kata kunci yang berkaitan dengan SDGs (Sustainable Development Goals).",
		secC.String(),
	))

	body.WriteString(docxBoxedSection(
		"D. PENDAHULUAN",
		"Pendahuluan dijelaskan tidak lebih dari 1.000 kata dengan font Tahoma ukuran 11 spasi 1,15 yang berisi uraian: Latar belakang dan rumusan permasalahan; Pendekatan pemecahan masalah; State of the art dan kebaruan.",
		docxRichParagraphs(d.Introduction),
	))

	body.WriteString(docxBoxedSection(
		"E. TINJAUAN PUSTAKA",
		"Tinjauan Pustaka dijelaskan dengan font Tahoma ukuran 11 spasi 1,15 yang mengemukakan Sumber pustaka/referensi primer yang relevan dan mengutamakan jurnal ilmiah/paten terkini (10 tahun terakhir).",
		docxRichParagraphs(d.Literature),
	))

	var secF strings.Builder
	secF.WriteString(docxRichParagraphs(d.Method))
	if diagram, ok := diagrams["method"]; ok {
		secF.WriteString(diagram.drawing())
		embedded = append(embedded, diagram)
	}
	body.WriteString(docxBoxedSection(
		"F. METODE",
		"Metode dijelaskan dengan font Tahoma ukuran 11 spasi 1,15, wajib dilengkapi diagram alir penelitian (JPG/PNG) serta memuat proses, luaran, indikator capaian, dan penanggung jawab.",
		secF.String(),
	))

	var secG strings.Builder
	secG.WriteString(docxRichParagraphs(d.Expected))
	if len(d.Outputs) > 0 {
		outRows := [][]string{}
		for i, o := range d.Outputs {
			outRows = append(outRows, []string{strconv.Itoa(i + 1), o.Kind, o.Status, strconv.Itoa(o.Year)})
		}
		secG.WriteString(docxTable([]string{"No", "Jenis Luaran", "Status Target", "Tahun"}, outRows, []int{700, 4000, 2500, 1400}))
	}
	body.WriteString(docxBoxedSection(
		"G. HASIL YANG DIHARAPKAN",
		"Jelaskan hasil yang diharapkan atau luaran yang dijanjikan dari penelitian.",
		secG.String(),
	))

	var secH strings.Builder
	secH.WriteString(docxParagraph("Tabel. Rencana Anggaran Biaya Penelitian", true, 20, "left", 80))
	costRows := [][]string{}
	for i, cost := range d.Costs {
		desc := cost.Category + ": " + cost.Item + " (" + cost.Quantity + " " + cost.Unit + ")"
		if cost.Reason != "" {
			desc += " - " + cost.Reason
		}
		costRows = append(costRows, []string{strconv.Itoa(i + 1), desc, formatSubtotalRupiah(cost.Quantity, cost.Price)})
	}
	costRows = append(costRows, []string{"", "TOTAL", formatRupiahID(p.Budget)})
	secH.WriteString(docxTable([]string{"No", "Jenis Pengeluaran", "Biaya yang diusulkan (Rp)"}, costRows, []int{700, 5700, 2200}))
	body.WriteString(docxBoxedSection(
		"H. ANGGARAN BIAYA",
		"Justifikasi anggaran biaya ditulis dengan terperinci dan jelas. Pada anggaran biaya tidak diperkenankan adanya honor pelaksana kegiatan.",
		secH.String(),
	))

	var secI strings.Builder
	secI.WriteString(docxParagraph("RENCANA JADWAL PELAKSANAAN KEGIATAN", true, 20, "center", 80))
	schRows := [][]string{}
	for i, sch := range d.Schedule {
		schRows = append(schRows, []string{strconv.Itoa(i + 1), sch.Name, fmt.Sprintf("Bulan %d - %d", sch.From, sch.To)})
	}
	if len(schRows) == 0 {
		schRows = append(schRows, []string{"-", "-", "-"})
	}
	secI.WriteString(docxTable([]string{"No", "Nama Kegiatan", "Bulan"}, schRows, []int{700, 5900, 2000}))
	body.WriteString(docxBoxedSection(
		"I. Jadwal Pelaksanaan",
		"Jadwal kegiatan selama waktu durasi penelitian dituliskan dengan jelas sesuai pekerjaan, jadwal kegiatan jelas kaitannya dengan tahapan pekerjaan di metodologi.",
		secI.String(),
	))

	body.WriteString(docxBoxedSection(
		"J. Daftar Pustaka",
		"Daftar pustaka disusun dan ditulis berdasarkan APA style sesuai dengan urutan pengutipan. Hanya pustaka yang disitasi pada usulan penelitian yang dicantumkan dalam Daftar Pustaka.",
		docxRichParagraphs(d.References),
	))

	rawDocx, err := buildDocxBytes(body.String(), embedded...)
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
