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
	"strconv"

	"github.com/gin-gonic/gin"
)

func validDiagram(kind string) bool { return kind == "roadmap" || kind == "method" }

func (s service) saveDiagram(c *gin.Context, a actor) {
	id := target(c)
	kind := c.Param("kind")
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
	content, err := io.ReadAll(io.LimitReader(file, (2<<20)+1))
	if err != nil || len(content) > 2<<20 {
		c.Status(400)
		return
	}
	revision, err := strconv.Atoi(c.Request.FormValue("revision"))
	if err != nil || revision < 1 {
		c.Status(400)
		return
	}
	config, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || (format != "png" && format != "jpeg") || config.Width < 1 || config.Height < 1 || int64(config.Width)*int64(config.Height) > 12000000 {
		c.JSON(400, gin.H{"error": "invalid_image", "message": "Unggah gambar JPG/PNG hingga 2 MB dan 12 megapiksel."})
		return
	}
	s.change(c, a, "research.diagram.save", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if _, err := lockDraft(ctx, tx, a, id, revision); err != nil {
			return 0, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO research_proposal_images (proposal_id,kind,mime,content) VALUES (?,?,?,?)
   ON DUPLICATE KEY UPDATE mime=VALUES(mime),content=VALUES(content)`, id, kind, "image/"+format, content); err != nil {
			return 0, err
		}
		_, err := tx.ExecContext(ctx, "UPDATE research_proposals SET revision=revision+1,verification_requested=FALSE WHERE id=?", id)
		return id, err
	})
}

func (s service) getDiagram(c *gin.Context, a actor) {
	id := target(c)
	kind := c.Param("kind")
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
