package iam

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

const achievementProposalScope = "p.id=? AND p.institution_id=? AND p.owner_user_id=? AND p.status<>'archived'"

type achievementOutput struct {
	Key string `json:"key"`
	outputInput
}

type achievementAttachment struct {
	Slot     string `json:"slot"`
	DriveURL string `json:"driveUrl"`
	HasFile  bool   `json:"hasFile"`
}

type achievementProposalReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func achievementOutputs(ctx context.Context, db achievementProposalReader, a actor, id int64, lock bool) ([]achievementOutput, error) {
	query := "SELECT p.payload FROM research_proposals p WHERE " + achievementProposalScope
	if lock {
		query += " FOR UPDATE"
	}
	var payload []byte
	if err := db.QueryRowContext(ctx, query, id, a.tenant, a.ID).Scan(&payload); err != nil {
		return nil, err
	}
	var data proposalData
	if err := json.Unmarshal(payload, &data); err != nil {
		return nil, err
	}

	outputs := make([]achievementOutput, 0, len(data.Outputs))
	occurrences := make(map[outputInput]int)
	for _, output := range data.Outputs {
		occurrences[output]++
		// Include the promised target and its occurrence to keep distinct rows independent.
		fingerprint := sha256.Sum256([]byte(fmt.Sprintf("%q/%q/%d", output.Kind, output.Status, output.Year)))
		key := fmt.Sprintf("output-%x-%d", fingerprint, occurrences[output])
		outputs = append(outputs, achievementOutput{Key: key, outputInput: output})
	}
	return outputs, nil
}

func validAchievementSlot(slot string, outputs []achievementOutput) bool {
	switch slot {
	case "proposal", "progress", "final":
		return true
	}
	for _, output := range outputs {
		if output.Key == slot {
			return true
		}
	}
	return false
}

func (s service) listResearchAchievements(c *gin.Context, a actor) {
	ctx := c.Request.Context()
	id := target(c)
	outputs, err := achievementOutputs(ctx, s.db, a, id, false)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(http.StatusNotFound)
		return
	}
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	rows, err := s.db.QueryContext(ctx, `SELECT u.slot, COALESCE(u.drive_url,''), u.media_type IS NOT NULL
 FROM research_achievement_uploads u JOIN research_proposals p ON p.id=u.proposal_id
 WHERE `+achievementProposalScope, id, a.tenant, a.ID)
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	defer rows.Close()
	attachments := []achievementAttachment{}
	for rows.Next() {
		var attachment achievementAttachment
		if err := rows.Scan(&attachment.Slot, &attachment.DriveURL, &attachment.HasFile); err != nil {
			c.Status(http.StatusServiceUnavailable)
			return
		}
		if validAchievementSlot(attachment.Slot, outputs) {
			attachments = append(attachments, attachment)
		}
	}
	if rows.Err() != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.JSON(http.StatusOK, gin.H{"outputs": outputs, "attachments": attachments})
}

func validAchievementDriveURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || len(raw) > 2048 || parsed.Scheme != "https" || parsed.User != nil || parsed.Path == "" || parsed.Path == "/" {
		return false
	}
	return strings.EqualFold(parsed.Host, "drive.google.com") || strings.EqualFold(parsed.Host, "docs.google.com")
}

func (s service) saveResearchAchievement(c *gin.Context, a actor) {
	id, slot := target(c), c.Param("slot")
	var driveURL, mediaType any
	var content []byte
	if c.Request.Method == http.MethodPut {
		if err := c.Request.ParseMultipartForm((5 << 20) + (64 << 10)); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"message": "Form unggahan tidak valid atau ukuran berkas melebihi 5 MB."})
			return
		}
		defer c.Request.MultipartForm.RemoveAll()

		rawURL := strings.TrimSpace(c.Request.PostFormValue("driveUrl"))
		files := c.Request.MultipartForm.File["file"]
		switch {
		case rawURL != "" && len(files) == 0 && validAchievementDriveURL(rawURL):
			driveURL = rawURL
		case rawURL == "" && len(files) == 1:
			media, bytes, err := readProofUpload(c, "file")
			if err != nil {
				c.JSON(http.StatusBadRequest, gin.H{"message": "Unggah berkas PDF, JPG, atau PNG dengan ukuran maksimal 5 MB."})
				return
			}
			mediaType, content = media, bytes
		default:
			c.JSON(http.StatusBadRequest, gin.H{"message": "Pilih satu berkas atau masukkan tautan HTTPS Google Drive yang valid."})
			return
		}
	}
	action := "research.achievement.save"
	if c.Request.Method == http.MethodDelete {
		action = "research.achievement.delete"
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		outputs, err := achievementOutputs(ctx, tx, a, id, true)
		if err != nil {
			return 0, err
		}
		if !validAchievementSlot(slot, outputs) {
			return 0, sql.ErrNoRows
		}
		if c.Request.Method == http.MethodDelete {
			_, err = tx.ExecContext(ctx, "DELETE FROM research_achievement_uploads WHERE proposal_id=? AND slot=?", id, slot)
			return id, err
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO research_achievement_uploads (proposal_id,slot,drive_url,media_type,content)
 VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE drive_url=VALUES(drive_url),media_type=VALUES(media_type),content=VALUES(content)`,
			id, slot, driveURL, mediaType, content)
		return id, err
	})
}

func (s service) downloadResearchAchievement(c *gin.Context, a actor) {
	var slot, media string
	var content []byte
	err := s.db.QueryRowContext(c.Request.Context(), `SELECT u.slot,u.media_type,u.content
 FROM research_achievement_uploads u JOIN research_proposals p ON p.id=u.proposal_id
 WHERE `+achievementProposalScope+" AND u.slot=? AND u.media_type IS NOT NULL",
		target(c), a.tenant, a.ID, c.Param("slot")).Scan(&slot, &media, &content)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(http.StatusNotFound)
		return
	}
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	extension := map[string]string{"application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg"}[media]
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=capaian-%s.%s", slot, extension))
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, media, content)
}
