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

const achievementInstitutionScope = "p.id=? AND p.institution_id=? AND p.status<>'archived'"
const achievementProposalScope = achievementInstitutionScope + " AND p.owner_user_id=?"

type achievementOutput struct {
	Key string `json:"key"`
	outputInput
}

type achievementAttachment struct {
	Slot     string `json:"slot"`
	DriveURL string `json:"driveUrl"`
	HasFile  bool   `json:"hasFile"`
	Approved bool   `json:"approved"`
}

type achievementProposalReader interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

func achievementOutputs(ctx context.Context, db achievementProposalReader, a actor, id int64, lock bool) ([]achievementOutput, error) {
	return readAchievementOutputs(ctx, db, achievementProposalScope, lock, id, a.tenant, a.ID)
}

func readAchievementOutputs(ctx context.Context, db achievementProposalReader, scope string, lock bool, args ...any) ([]achievementOutput, error) {
	query := "SELECT p.payload FROM research_proposals p WHERE " + scope
	if lock {
		query += " FOR UPDATE"
	}
	var payload []byte
	if err := db.QueryRowContext(ctx, query, args...).Scan(&payload); err != nil {
		return nil, err
	}
	return decodeAchievementOutputs(payload)
}

func decodeAchievementOutputs(payload []byte) ([]achievementOutput, error) {
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
	rows, err := s.db.QueryContext(ctx, `SELECT u.slot, COALESCE(u.drive_url,''), u.media_type IS NOT NULL, u.approved_at IS NOT NULL
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
		if err := rows.Scan(&attachment.Slot, &attachment.DriveURL, &attachment.HasFile, &attachment.Approved); err != nil {
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
		_, err = tx.ExecContext(ctx, `INSERT INTO research_achievement_uploads (proposal_id,slot,drive_url,media_type,content,upload_version)
 VALUES (?,?,?,?,?, UUID()) ON DUPLICATE KEY UPDATE drive_url=VALUES(drive_url),media_type=VALUES(media_type),
 content=VALUES(content),upload_version=VALUES(upload_version),approved_at=NULL`,
			id, slot, driveURL, mediaType, content)
		return id, err
	})
}

func (s service) downloadResearchAchievement(c *gin.Context, a actor) {
	s.serveAchievementDownload(c, achievementProposalScope, target(c), a.tenant, a.ID)
}

func (s service) downloadAchievementForReview(c *gin.Context, a actor) {
	s.serveAchievementDownload(c, achievementInstitutionScope, target(c), a.tenant)
}

func (s service) serveAchievementDownload(c *gin.Context, scope string, args ...any) {
	var slot, media string
	var content []byte
	err := s.db.QueryRowContext(c.Request.Context(), `SELECT u.slot,u.media_type,u.content
 FROM research_achievement_uploads u JOIN research_proposals p ON p.id=u.proposal_id
 WHERE `+scope+" AND u.slot=? AND u.media_type IS NOT NULL",
		append(args, c.Param("slot"))...).Scan(&slot, &media, &content)
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

type achievementReview struct {
	achievementAttachment
	ProposalID int64  `json:"proposalId"`
	Title      string `json:"title"`
	Owner      string `json:"owner"`
	Label      string `json:"label"`
	Version    string `json:"version"`
}

func (s service) listAchievementReviews(c *gin.Context, a actor) {
	rows, err := s.db.QueryContext(c.Request.Context(), `SELECT p.id,p.title,owner.display_name,p.payload,
 u.slot,COALESCE(u.drive_url,''),u.media_type IS NOT NULL,u.approved_at IS NOT NULL,COALESCE(u.upload_version,'')
 FROM research_achievement_uploads u
 JOIN research_proposals p ON p.id=u.proposal_id
 JOIN users owner ON owner.id=p.owner_user_id
 WHERE p.institution_id=? AND p.status<>'archived'
 ORDER BY u.approved_at IS NOT NULL,p.id DESC,u.slot`, a.tenant)
	if err != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	defer rows.Close()
	items := []achievementReview{}
	for rows.Next() {
		var item achievementReview
		var payload []byte
		if err := rows.Scan(&item.ProposalID, &item.Title, &item.Owner, &payload, &item.Slot, &item.DriveURL, &item.HasFile, &item.Approved, &item.Version); err != nil {
			c.Status(http.StatusServiceUnavailable)
			return
		}
		switch item.Slot {
		case "proposal":
			item.Label = "Proposal Penelitian"
		case "progress":
			item.Label = "Laporan Kemajuan"
		case "final":
			item.Label = "Laporan Akhir"
		default:
			outputs, err := decodeAchievementOutputs(payload)
			if err != nil {
				c.Status(http.StatusServiceUnavailable)
				return
			}
			for _, output := range outputs {
				if output.Key == item.Slot {
					item.Label = fmt.Sprintf("%s · %s · %d", output.Kind, output.Status, output.Year)
					break
				}
			}
			if item.Label == "" {
				continue
			}
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		c.Status(http.StatusServiceUnavailable)
		return
	}
	c.JSON(http.StatusOK, items)
}

var staleAchievement = errors.New("achievement upload changed")

func (s service) approveResearchAchievement(c *gin.Context, a actor) {
	var input struct {
		Version *string `json:"version" binding:"required"`
	}
	if c.ShouldBindJSON(&input) != nil || len(*input.Version) > 36 {
		c.Status(http.StatusBadRequest)
		return
	}
	id, slot := target(c), c.Param("slot")
	s.change(c, a, "research.achievement.approve", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		outputs, err := readAchievementOutputs(ctx, tx, achievementInstitutionScope, true, id, a.tenant)
		if err != nil {
			return 0, err
		}
		if !validAchievementSlot(slot, outputs) {
			return 0, sql.ErrNoRows
		}
		result, err := tx.ExecContext(ctx, `UPDATE research_achievement_uploads SET approved_at=UTC_TIMESTAMP(6)
 WHERE proposal_id=? AND slot=? AND COALESCE(upload_version,'')=? AND approved_at IS NULL`, id, slot, *input.Version)
		if err != nil {
			return 0, err
		}
		count, err := result.RowsAffected()
		if err == nil && count == 0 {
			return 0, staleAchievement
		}
		return id, err
	})
}
