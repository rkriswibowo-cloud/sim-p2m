package iam

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"io"
	"strings"
	"testing"
)

func TestProposalDocxLayout(t *testing.T) {
	diagram := docxDiagram{Index: 1, Label: "Peta & metode", Extension: "png", Content: []byte{0, 1, 255}, Width: 1000, Height: 600}
	body := docxParagraph("Proposal", true, 34, "center", 100) +
		docxHeading("Halaman Pengesahan", "center", true) +
		docxHeading("Identitas dan Uraian Umum", "left", true) +
		docxTable([]string{"Judul", "Keterangan"}, [][]string{{"Judul", "Usulan"}}, []int{3000, 6000}) + diagram.drawing()
	raw, err := buildDocxBytes(body, diagram)
	if err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		t.Fatal(err)
	}
	files := map[string][]byte{}
	for _, file := range archive.File {
		reader, err := file.Open()
		if err != nil {
			t.Fatal(err)
		}
		content, err := io.ReadAll(reader)
		reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		files[file.Name] = content
		if strings.HasSuffix(file.Name, ".xml") || strings.HasSuffix(file.Name, ".rels") {
			if err := xml.Unmarshal(content, &struct{}{}); err != nil {
				t.Fatalf("%s: %v", file.Name, err)
			}
		}
	}
	document := string(files["word/document.xml"])
	if strings.Count(document, `<w:pageBreakBefore/>`) != 2 || !strings.Contains(document, `<w:tblHeader/>`) ||
		!strings.Contains(document, `r:embed="rIdImage1"`) || !strings.Contains(string(files["word/_rels/document.xml.rels"]), `Target="media/diagram1.png"`) ||
		!bytes.Equal(files["word/media/diagram1.png"], diagram.Content) {
		t.Fatal("page boundaries, repeating header or diagram parts are missing")
	}
}
