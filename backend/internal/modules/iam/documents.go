package iam

import (
	"mime"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
)

const documentsRead = "documents.read"

type documentTemplate struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

var documentTemplates = []documentTemplate{
	{"proposal", "Template Proposal Penelitian.docx"},
	{"student-letter", "Surat Pernyataan - Keterlibatan Mahasiswa dalam Penelitian Dosen.docx"},
	{"progress", "Template Laporan Kemajuan Penelitian.docx"},
	{"final", "Template Laporan Akhir Penelitian.docx"},
}

func documentDirectory() string {
	if folder := os.Getenv("SIMP2M_DOCUMENT_DIR"); folder != "" {
		return folder
	}
	return ".."
}

func (s service) listDocuments(c *gin.Context, _ actor) {
	items := []documentTemplate{}
	for _, item := range documentTemplates {
		if info, err := os.Stat(filepath.Join(documentDirectory(), item.Name)); err == nil && info.Mode().IsRegular() {
			items = append(items, item)
		}
	}
	c.JSON(200, items)
}

func (s service) downloadDocument(c *gin.Context, _ actor) {
	for _, item := range documentTemplates {
		if item.ID != c.Param("document") {
			continue
		}
		file, err := os.Open(filepath.Join(documentDirectory(), item.Name))
		if err != nil {
			c.Status(404)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil || !info.Mode().IsRegular() {
			c.Status(404)
			return
		}
		c.Header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
		c.Header("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": item.Name}))
		c.Header("Cache-Control", "private, no-store")
		c.Header("X-Content-Type-Options", "nosniff")
		http.ServeContent(c.Writer, c.Request, item.Name, info.ModTime(), file)
		return
	}
	c.Status(404)
}
