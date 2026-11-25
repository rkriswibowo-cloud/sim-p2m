package iam

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"image"
	_ "image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

func validDiagram(kind string) bool {
	return kind == "roadmap" || kind == "method" || kind == "student_letter" || kind == "poster"
}

func (s service) saveDiagram(c *gin.Context, a actor) {
	s.saveDiagramKind(c, a, c.Param("kind"), false)
}

func (s service) saveDiagramKind(c *gin.Context, a actor, kind string, finalReport bool) {
	id := target(c)
	if id < 1 || !validDiagram(kind) {
		c.Status(400)
		return
	}
	file, _, err := c.Request.FormFile("image")
	if err != nil {
		c.Status(400)
		return
	}
	defer file.Close()
	if c.Request.MultipartForm != nil {
		defer c.Request.MultipartForm.RemoveAll()
	}
	maxSize := int64(2 << 20)
	if kind == "student_letter" {
		maxSize = 5 << 20
	}
	content, err := io.ReadAll(io.LimitReader(file, maxSize+1))
	if err != nil || int64(len(content)) > maxSize {
		c.JSON(400, gin.H{"error": "file_too_large", "message": "Ukuran berkas melampaui batas yang diizinkan."})
		return
	}
	revision, err := strconv.Atoi(c.Request.FormValue("revision"))
	if !finalReport && (err != nil || revision < 1) {
		c.Status(400)
		return
	}
	var mimeType string
	if kind == "student_letter" {
		detected := http.DetectContentType(content)
		if detected == "application/pdf" || strings.HasPrefix(string(content), "%PDF-") {
			mimeType = "application/pdf"
		} else {
			config, format, err := image.DecodeConfig(bytes.NewReader(content))
			if err != nil || (format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 12000000 {
				c.JSON(400, gin.H{"error": "invalid_file", "message": "Surat keterlibatan mahasiswa harus berformat PDF, JPG, atau PNG (maks. 5 MB)."})
				return
			}
			mimeType = "image/" + format
		}
	} else {
		config, format, err := image.DecodeConfig(bytes.NewReader(content))
		if err != nil || (format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 12000000 {
			c.JSON(400, gin.H{"error": "invalid_image", "message": "Unggah gambar JPG/PNG hingga 2 MB dan 12 megapiksel."})
			return
		}
		mimeType = "image/" + format
	}
	if finalReport && mimeType != "image/jpeg" {
		c.JSON(400, gin.H{"message": "Poster laporan akhir harus berupa JPG, maksimal 2 MB."})
		return
	}
	s.change(c, a, "research.diagram.save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if kind == "poster" {
			var enabled bool
			err := tx.QueryRowContext(ctx, `SELECT g.allow_final_report FROM research_proposals p
 JOIN grant_scheme_versions v ON v.institution_id=p.institution_id AND v.id=p.grant_version_id
 JOIN grant_periods g ON g.institution_id=v.institution_id AND g.id=v.period_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=? AND p.status='submitted' FOR UPDATE`, a.tenant, a.ID, id).Scan(&enabled)
			if err != nil {
				return 0, err
			}
			if finalReport && !enabled {
				return 0, invalidProposal
			}
		} else {
			if _, err := lockDraft(ctx, tx, a, id, revision); err != nil {
				return 0, err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO research_proposal_images (proposal_id,kind,mime,content) VALUES (?,?,?,?)
   ON DUPLICATE KEY UPDATE mime=VALUES(mime),content=VALUES(content)`, id, kind, mimeType, content); err != nil {
			return 0, err
		}
		if kind == "poster" {
			return id, nil
		}
		_, err := tx.ExecContext(ctx, "UPDATE research_proposals SET revision=revision+1,verification_requested=FALSE WHERE id=?", id)
		return id, err
	})
}

func (s service) getDiagram(c *gin.Context, a actor) {
	s.getDiagramKind(c, a, c.Param("kind"))
}

func (s service) getDiagramKind(c *gin.Context, a actor, kind string) {
	id := target(c)
	if id < 1 || !validDiagram(kind) {
		c.Status(404)
		return
	}
	var mime string
	var content []byte
	err := s.db.QueryRowContext(c.Request.Context(), `SELECT i.mime,i.content FROM research_proposal_images i
 JOIN research_proposals p ON p.id=i.proposal_id
 WHERE p.institution_id=? AND p.owner_user_id=? AND p.id=? AND p.status<>'archived' AND i.kind=?`, a.tenant, a.ID, id, kind).Scan(&mime, &content)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(404)
		return
	}
	if err != nil {
		c.Status(503)
		return
	}
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(200, mime, content)
}
