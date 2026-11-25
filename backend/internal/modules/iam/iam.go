package iam

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/go-sql-driver/mysql"
	"simp2m/backend/internal/modules/auth"
)

const read = "iam.read"
const manage = "iam.manage"
const auditRead = "audit.read"

type service struct {
	db     *sql.DB
	auth   auth.Store
	origin string
	trial  bool
}

type actor struct {
	auth.Identity
	tenant int64
	role   string
	mode   string
}

func Register(router *gin.Engine, live, trial *sql.DB, origin string) {
	liveService := service{db: live, auth: auth.Store{DB: live}, origin: origin}
	liveService.routes(router.Group("/api/v1/iam"))
	if trial != nil {
		trialService := service{db: trial, auth: auth.Store{DB: live}, origin: origin, trial: true}
		trialService.routes(router.Group("/api/v1/trial/:role/iam"))
	}
}

func (s service) routes(r *gin.RouterGroup) {
	r.GET("/institutions/:institution/documents", s.scoped(documentsRead, s.listDocuments))
	r.GET("/institutions/:institution/documents/:document", s.scoped(documentsRead, s.downloadDocument))
	r.GET("/institutions/:institution/reports", s.scoped(reportsDraft, s.listReports))
	r.PUT("/institutions/:institution/reports/:target/:kind", s.mutationWithLimit(reportsDraft, s.changeReport, 1<<20))
	r.DELETE("/institutions/:institution/reports/:target/:kind", s.mutation(reportsDraft, s.changeReport))
	r.GET("/institutions/:institution/research", s.scoped(researchApply, s.listProposals))
	r.GET("/institutions/:institution/research/options", s.scoped(researchApply, s.researchOptions))
	r.GET("/institutions/:institution/research/invitations", s.scoped(researchApply, s.listInvitations))
	r.GET("/institutions/:institution/research/verification", s.scoped(researchVerify, s.verificationQueue))
	r.POST("/institutions/:institution/research/verification/:target", s.mutation(researchVerify, s.verifyProposal))
	r.POST("/institutions/:institution/research/:target/verification", s.mutation(researchApply, s.requestVerification))
	r.POST("/institutions/:institution/research/:target/consent", s.mutation(researchApply, s.respondConsent))
	r.GET("/institutions/:institution/research/:target/export/proposal-docx", s.scoped(researchApply, s.exportProposalDocx))
	r.GET("/institutions/:institution/research/:target/export/student-letter-docx", s.scoped(researchApply, s.exportStudentLetterDocx))
	r.POST("/institutions/:institution/research/:target/grant", s.mutation(researchApply, s.refreshProposalGrant))
	r.GET("/institutions/:institution/research/:target", s.scoped(researchApply, s.getProposal))
	r.GET("/institutions/:institution/research/:target/journal", s.scoped(researchApply, s.listJournal))
	r.POST("/institutions/:institution/research/:target/journal", s.mutationWithLimit(researchApply, s.changeJournal, 64<<10))
	r.PUT("/institutions/:institution/research/:target/journal/:entry", s.mutationWithLimit(researchApply, s.changeJournal, 64<<10))
	r.DELETE("/institutions/:institution/research/:target/journal/:entry", s.mutation(researchApply, s.changeJournal))
	r.GET("/institutions/:institution/research/:target/images/:kind", s.scoped(researchApply, s.getDiagram))
	r.PUT("/institutions/:institution/research/:target/images/:kind", s.mutationWithLimit(researchApply, s.saveDiagram, (2<<20)+(32<<10)))
	r.POST("/institutions/:institution/research", s.mutation(researchApply, s.createProposal))
	r.PUT("/institutions/:institution/research/:target", s.mutationWithLimit(researchApply, s.saveProposal, 256<<10))
	r.POST("/institutions/:institution/research/:target/submit", s.mutation(researchApply, s.submitProposal))
	r.POST("/institutions/:institution/research/:target/resubmit", s.mutation(researchApply, s.resubmitProposal))
	r.DELETE("/institutions/:institution/research/:target", s.mutation(researchApply, s.archiveProposal))
	r.GET("/institutions/:institution/workflow/proposals", s.scoped(read, s.listWorkflowProposals))
	r.POST("/institutions/:institution/workflow/proposals/:target/transition", s.mutation(researchVerify, s.transitionProposal))
	r.POST("/institutions/:institution/workflow/proposals/:target/reviewers", s.mutation(researchVerify, s.assignReviewer))
	r.DELETE("/institutions/:institution/workflow/assignments/:target", s.mutation(researchVerify, s.removeReviewerAssignment))
	r.POST("/institutions/:institution/workflow/proposals/:target/decision", s.mutation(researchDecide, s.decideFunding))
	r.GET("/institutions/:institution/reviews", s.scoped(researchReview, s.listMyReviews))
	r.POST("/institutions/:institution/reviews/:target/conflict", s.mutation(researchReview, s.respondReviewAssignment))
	r.POST("/institutions/:institution/reviews/:target/submit", s.mutationWithLimit(researchReview, s.submitReview, 128<<10))
	r.GET("/institutions/:institution/projects", s.scoped(read, s.listProjects))
	r.POST("/institutions/:institution/projects/convert/:target", s.mutation(researchDecide, s.convertProposalToProject))
	r.POST("/institutions/:institution/projects/:target/amendments", s.mutation(researchDecide, s.amendProjectContract))
	r.GET("/institutions/:institution/projects/:target/contract-docx", s.scoped(read, s.exportContractDocx))
	r.POST("/institutions/:institution/projects/:target/disbursements", s.mutation(researchDecide, s.saveDisbursement))
	r.POST("/institutions/:institution/disbursements/:target/transfer", s.mutationWithLimit(researchDecide, s.markDisbursementTransferred, (5<<20)+(64<<10)))
	r.GET("/institutions/:institution/disbursements/:target/proof", s.scoped(read, s.downloadDisbursementProof))
	r.GET("/institutions/:institution/external-fundings", s.scoped(researchApply, s.listExternalFundings))
	r.POST("/institutions/:institution/external-fundings", s.mutation(researchApply, s.saveExternalFunding))
	r.PUT("/institutions/:institution/external-fundings/:target/proof", s.mutationWithLimit(researchApply, s.uploadExternalProof, (5<<20)+(64<<10)))
	r.GET("/institutions/:institution/external-fundings/:target/proof", s.scoped(researchApply, s.downloadExternalProof))
	r.POST("/institutions/:institution/external-fundings/:target/verify", s.mutation(researchVerify, s.verifyExternalFunding))
	r.GET("/institutions/:institution/monev/proposals", s.scoped(read, s.listMonevProposals))
	r.POST("/institutions/:institution/monev/proposals/:target", s.mutation(read, s.createMonevReview))
	r.POST("/institutions/:institution/monev/reviews/:target/follow-up", s.mutation(researchApply, s.respondMonevFollowUp))
	r.POST("/institutions/:institution/monev/proposals/:target/expenses", s.mutation(researchApply, s.addProjectExpense))
	r.DELETE("/institutions/:institution/monev/expenses/:target", s.mutation(researchApply, s.deleteProjectExpense))
	r.POST("/institutions/:institution/monev/proposals/:target/outputs", s.mutation(researchApply, s.saveResearchOutput))
	r.PUT("/institutions/:institution/monev/outputs/:target/proof", s.mutationWithLimit(researchApply, s.uploadOutputProof, (5<<20)+(64<<10)))
	r.GET("/institutions/:institution/monev/outputs/:target/proof", s.scoped(read, s.downloadOutputProof))
	r.POST("/institutions/:institution/monev/outputs/:target/verify", s.mutation(researchVerify, s.verifyResearchOutput))
	r.POST("/institutions/:institution/monev/proposals/:target/close", s.mutation(read, s.closeProject))
	r.GET("/institutions/:institution/analytics", s.scoped(read, s.analyticsOverview))
	r.GET("/institutions/:institution/analytics/export", s.scoped(read, s.analyticsExport))
	r.GET("/institutions/:institution/my-lecturer-profile", s.scoped(read, s.getMyLecturerProfile))
	r.PUT("/institutions/:institution/my-lecturer-profile", s.mutation(read, s.updateMyLecturerProfile))
	r.GET("/institutions/:institution/lecturers-with-accounts", s.scoped(masterRead, s.listLecturersWithAccounts))
	r.POST("/institutions/:institution/lecturers/:target/link-account", s.mutation(masterManage, s.linkLecturerAccount))
	r.GET("/institutions/:institution/community", s.scoped(communityDraft, s.listCommunity))
	r.POST("/institutions/:institution/community", s.mutationWithLimit(communityDraft, s.saveCommunity, 128<<10))
	r.PUT("/institutions/:institution/community/:target", s.mutationWithLimit(communityDraft, s.saveCommunity, 128<<10))
	r.DELETE("/institutions/:institution/community/:target", s.mutation(communityDraft, s.archiveCommunity))
	r.GET("/institutions/:institution/grants", s.scoped(grantRead, s.grantOverview))
	r.GET("/institutions/:institution/grants/options", s.scoped(grantManage, s.grantOptions))
	r.POST("/institutions/:institution/grants/periods", s.mutation(grantManage, s.saveGrantPeriod))
	r.PUT("/institutions/:institution/grants/periods/:target", s.mutation(grantManage, s.saveGrantPeriod))
	r.POST("/institutions/:institution/grants/periods/:period/versions", s.mutation(grantManage, s.publishGrantVersion))
	r.GET("/institutions/:institution/grants/versions/:target/eligibility", s.scoped(grantRead, s.grantEligibility))
	r.GET("/institutions/:institution/master-data/:kind", s.scoped(masterRead, s.listMaster))
	r.POST("/institutions/:institution/master-data/:kind", s.mutation(masterManage, s.saveMaster))
	r.PUT("/institutions/:institution/master-data/:kind/:target", s.mutation(masterManage, s.saveMaster))
	r.DELETE("/institutions/:institution/master-data/:kind/:target", s.mutation(masterManage, s.deleteMaster))
	if s.trial {
		r.POST("/enter", s.mutation(read, s.enterTrial))
	}
	r.GET("/institutions", s.institutions)
	r.POST("/institutions", s.mutation("system", s.createInstitution))
	r.GET("/institutions/:institution/workspace", s.scoped(read, s.workspace))
	r.GET("/institutions/:institution/audit", s.scoped(auditRead, s.audit))
	r.POST("/institutions/:institution/users", s.mutation(manage, s.createUser))
	r.POST("/institutions/:institution/memberships", s.mutation("system", s.addMembership))
	r.PUT("/institutions/:institution/users/:target", s.mutation("system", s.updateMembership))
	r.DELETE("/institutions/:institution/users/:target", s.mutation("system", s.updateMembership))
	r.POST("/institutions/:institution/roles", s.mutation("system", s.saveRole))
	r.PUT("/institutions/:institution/roles/:target", s.mutation("system", s.saveRole))
	r.DELETE("/institutions/:institution/roles/:target", s.mutation("system", s.deleteRole))
	r.PUT("/institutions/:institution", s.mutation("system", s.updateInstitution))
	r.DELETE("/institutions/:institution", s.mutation("system", s.updateInstitution))
	r.PUT("/users/:target/active", s.mutation("system", s.setActive))
	r.DELETE("/users/:target", s.mutation("system", s.setActive))
	r.PUT("/users/:target/superadmin", s.mutation("system", s.setSystemRole))
	r.PUT("/users/:target/profile", s.mutation("system", s.updateProfile))
}

func (s service) identify(c *gin.Context) (actor, bool) {
	c.Header("Cache-Control", "no-store")
	cookie, _ := c.Cookie(auth.AccessCookie)
	identity, err := s.auth.Me(c.Request.Context(), cookie)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			c.Status(401)
		} else {
			c.Status(503)
		}
		return actor{}, false
	}
	a := actor{Identity: identity, role: identity.Role, mode: "production"}
	if s.trial {
		if a.Role != "superadmin" {
			c.Status(403)
			return actor{}, false
		}
		a.mode = "trial"
		a.role = c.Param("role")
		if a.role != "trial-admin" && a.role != "trial-reader" {
			c.Status(404)
			return actor{}, false
		}
	}
	return a, true
}

func (a actor) system() bool {
	return a.Identity.Role == "superadmin" && (a.mode == "production" || a.role == "trial-admin")
}

func (s service) authorize(c *gin.Context, a *actor, permission string) bool {
	id := c.Param("institution")
	if id != "" {
		var err error
		a.tenant, err = strconv.ParseInt(id, 10, 64)
		if err != nil || a.tenant < 1 {
			c.Status(400)
			return false
		}
	}
	if a.system() {
		return true
	}
	if a.mode == "trial" && (permission == read || permission == auditRead || permission == masterRead || permission == grantRead || permission == researchApply || permission == communityDraft) {
		return true
	}
	if permission == "system" || a.mode == "trial" {
		c.Status(403)
		return false
	}
	err := s.roleForPermission(c.Request.Context(), *a, permission, &a.role)
	if errors.Is(err, sql.ErrNoRows) {
		c.Status(403)
		return false
	}
	if err != nil {
		c.Status(503)
		return false
	}
	return true
}

func (s service) roleForPermission(ctx context.Context, a actor, permission string, role *string) error {
	return s.db.QueryRowContext(ctx, `SELECT effective_role FROM effective_membership_permissions
  WHERE user_id=? AND institution_id=? AND permission_code=? ORDER BY effective_role LIMIT 1`, a.ID, a.tenant, permission).Scan(role)
}

type operation func(*gin.Context, actor)

func (s service) scoped(permission string, next operation) gin.HandlerFunc {
	return func(c *gin.Context) {
		a, ok := s.identify(c)
		if ok && s.authorize(c, &a, permission) {
			next(c, a)
		}
	}
}

func (s service) mutation(permission string, next operation) gin.HandlerFunc {
	return s.mutationWithLimit(permission, next, 8192)
}

func (s service) mutationWithLimit(permission string, next operation, limit int64) gin.HandlerFunc {
	handler := s.scoped(permission, next)
	return func(c *gin.Context) {
		if c.GetHeader("Origin") != s.origin || ((permission == researchApply || permission == communityDraft) && s.trial && c.Param("role") == "trial-reader") {
			c.Status(403)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, limit)
		handler(c)
	}
}

func (s service) institutions(c *gin.Context) {
	a, ok := s.identify(c)
	if !ok {
		return
	}
	query := "SELECT id,code,name,is_active, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE, TRUE FROM institutions ORDER BY name LIMIT 200"
	var params []any
	if a.mode == "production" && !a.system() {
		query = `SELECT i.id,i.code,i.name,i.is_active,
   COALESCE(MAX(p.permission_code='iam.read'),FALSE),
   COALESCE(MAX(p.permission_code='audit.read'),FALSE),
   COALESCE(MAX(p.permission_code='masterdata.read'),FALSE),
   COALESCE(MAX(p.permission_code='masterdata.manage'),FALSE),
   COALESCE(MAX(p.permission_code='grants.read'),FALSE),
   COALESCE(MAX(p.permission_code='research.apply'),FALSE),
   COALESCE(MAX(p.permission_code='community.draft'),FALSE),
   COALESCE(MAX(p.permission_code='documents.read'),FALSE),
   COALESCE(MAX(p.permission_code='reports.draft'),FALSE),
   COALESCE(MAX(p.permission_code='research.verify'),FALSE),
   COALESCE(MAX(p.permission_code='research.review'),FALSE),
   COALESCE(MAX(p.permission_code='research.decide'),FALSE)
   FROM institutions i JOIN memberships m ON m.institution_id=i.id
   LEFT JOIN effective_membership_permissions p ON p.institution_id=i.id AND p.user_id=m.user_id
   WHERE m.user_id=? AND m.is_active AND i.is_active
   GROUP BY i.id,i.code,i.name,i.is_active ORDER BY i.name LIMIT 200`
		params = []any{a.ID}
	}
	rows, err := s.db.QueryContext(c.Request.Context(), query, params...)
	if err != nil {
		c.Status(503)
		return
	}
	defer rows.Close()
	type institution struct {
		ID              int64  `json:"id"`
		Code            string `json:"code"`
		Name            string `json:"name"`
		Active          bool   `json:"active"`
		CanRead         bool   `json:"canRead"`
		CanAudit        bool   `json:"canAudit"`
		CanMasterRead   bool   `json:"canMasterRead"`
		CanMasterManage bool   `json:"canMasterManage"`
		CanGrantRead    bool   `json:"canGrantRead"`
		CanResearch     bool   `json:"canResearch"`
		CanCommunity    bool   `json:"canCommunity"`
		CanDocuments    bool   `json:"canDocuments"`
		CanReports      bool   `json:"canReports"`
		CanVerify       bool   `json:"canVerify"`
		CanReview       bool   `json:"canReview"`
		CanDecide       bool   `json:"canDecide"`
	}
	records := []institution{}
	for rows.Next() {
		var item institution
		if rows.Scan(&item.ID, &item.Code, &item.Name, &item.Active, &item.CanRead, &item.CanAudit, &item.CanMasterRead, &item.CanMasterManage, &item.CanGrantRead, &item.CanResearch, &item.CanCommunity, &item.CanDocuments, &item.CanReports, &item.CanVerify, &item.CanReview, &item.CanDecide) != nil {
			c.Status(503)
			return
		}
		if a.mode == "trial" && !a.system() {
			item.CanMasterManage = false
		}
		records = append(records, item)
	}
	if rows.Err() != nil {
		c.Status(503)
		return
	}
	c.JSON(200, gin.H{"items": records, "system": a.system(), "mode": a.mode, "role": a.role})
}

var invalid = errors.New("invalid")
var conflict = errors.New("conflict")
var forbidden = errors.New("forbidden")

func (s service) change(c *gin.Context, a actor, action string, work func(context.Context, *sql.Tx) (int64, error)) {
	ctx := c.Request.Context()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		c.Status(503)
		return
	}
	defer tx.Rollback()
	subject, err := work(ctx, tx)
	if err == nil {
		var actorID any = a.ID
		if s.trial {
			actorID = nil
		}
		var tenant any
		if a.tenant != 0 {
			tenant = a.tenant
		}
		_, err = tx.ExecContext(ctx, `INSERT INTO audit_events (actor_user_id,institution_id,effective_role,mode,action,subject)
    VALUES (?,?,?,?,?,?)`, actorID, tenant, a.role, a.mode, action, fmt.Sprintf("target:%d actor:%d", subject, a.ID))
	}
	if err == nil {
		err = tx.Commit()
	}
	var mysqlErr *mysql.MySQLError
	switch {
	case err == nil:
		c.JSON(200, gin.H{"id": subject})
	case errors.Is(err, invalidProposal):
		c.JSON(400, gin.H{"error": "validation", "message": strings.TrimPrefix(err.Error(), invalidProposal.Error()+": ")})
	case errors.Is(err, eligibilityBlocked):
		c.JSON(409, gin.H{"error": "eligibility", "message": strings.TrimPrefix(err.Error(), eligibilityBlocked.Error()+": ")})
	case errors.Is(err, unavailableGrant):
		c.JSON(409, gin.H{"error": "grant_unavailable", "message": "Periode sudah tidak terbuka atau versi skema telah digantikan."})
	case errors.Is(err, staleProposal):
		c.JSON(409, gin.H{"error": "stale_revision", "message": "Draf berubah di sesi lain atau sudah dikirim. Muat ulang usulan sebelum melanjutkan."})
	case errors.Is(err, quotaFull):
		c.JSON(409, gin.H{"error": "quota_full", "message": "Kuota skema sudah penuh."})
	case errors.Is(err, invalid):
		c.JSON(400, gin.H{"error": "invalid_input"})
	case errors.Is(err, conflict):
		c.JSON(409, gin.H{"error": "last_superadmin"})
	case errors.Is(err, publishedPeriod):
		c.JSON(409, gin.H{"error": "published_period"})
	case (strings.HasPrefix(action, "masterdata.") || strings.HasPrefix(action, "grants.period.")) && errors.As(err, &mysqlErr) && mysqlErr.Number == 1062:
		c.JSON(409, gin.H{"error": "duplicate_code"})
	case errors.Is(err, forbidden):
		c.Status(403)
	case errors.Is(err, sql.ErrNoRows):
		c.Status(404)
	default:
		c.Status(503)
	}
}

func target(c *gin.Context) int64 {
	id, _ := strconv.ParseInt(c.Param("target"), 10, 64)
	return id
}

func (s service) createInstitution(c *gin.Context, a actor) {
	var input struct {
		Code string
		Name string
	}
	if c.ShouldBindJSON(&input) != nil {
		c.Status(400)
		return
	}
	input.Code = strings.ToUpper(strings.TrimSpace(input.Code))
	input.Name = strings.TrimSpace(input.Name)
	if input.Name == "" || input.Code == "" || len(input.Code) > 32 || len(input.Name) > 200 {
		c.Status(400)
		return
	}
	s.change(c, a, "institution.create", func(ctx context.Context, tx *sql.Tx) (int64, error) {
		result, err := tx.ExecContext(ctx, "INSERT INTO institutions(code,name) VALUES (?,?)", input.Code, input.Name)
		if err != nil {
			return 0, err
		}
		return result.LastInsertId()
	})
}

func (s service) updateInstitution(c *gin.Context, a actor) {
	deleting := c.Request.Method == http.MethodDelete
	active := false
	action := "institution.delete"
	var input struct {
		Name   string
		Active *bool
	}
	if !deleting {
		if c.ShouldBindJSON(&input) != nil || strings.TrimSpace(input.Name) == "" || len(input.Name) > 200 || input.Active == nil {
			c.Status(400)
			return
		}
		active, action = *input.Active, "institution.update"
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		if err := lockSystemAccounts(ctx, tx); err != nil {
			return 0, err
		}
		var id int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM institutions WHERE id=? FOR UPDATE", a.tenant).Scan(&id); err != nil {
			return 0, err
		}
		if !active {
			var hasSystem bool
			if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM memberships m
			 JOIN system_role_assignments r ON r.user_id=m.user_id WHERE m.institution_id=? AND m.is_active)`, id).Scan(&hasSystem); err != nil {
				return 0, err
			}
			if hasSystem {
				return 0, conflict
			}
		}
		if deleting {
			_, err := tx.ExecContext(ctx, "UPDATE institutions SET is_active=FALSE WHERE id=?", id)
			return id, err
		}
		_, err := tx.ExecContext(ctx, "UPDATE institutions SET name=?, is_active=? WHERE id=?", strings.TrimSpace(input.Name), active, id)
		return id, err
	})
}

func (s service) setActive(c *gin.Context, a actor) {
	id := target(c)
	var input struct{ Active *bool }
	deleting := c.Request.Method == http.MethodDelete
	active := false
	action := "user.delete"
	if id < 1 || (!deleting && (c.ShouldBindJSON(&input) != nil || input.Active == nil)) {
		c.Status(400)
		return
	}
	if !deleting {
		active, action = *input.Active, "user.active"
	}
	s.change(c, a, action, func(ctx context.Context, tx *sql.Tx) (int64, error) {
		// All changes to global user activity serialize on the first organization row.
		if err := lockSystemAccounts(ctx, tx); err != nil {
			return 0, err
		}
		var isSystem bool
		if err := tx.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM system_role_assignments WHERE user_id=u.id)
   FROM users u WHERE u.id=? FOR UPDATE`, id).Scan(&isSystem); err != nil {
			return 0, err
		}
		if isSystem && !active {
			if err := keepSystemAccount(ctx, tx, id); err != nil {
				return 0, err
			}
		}
		if _, err := tx.ExecContext(ctx, "UPDATE users SET is_active=? WHERE id=?", active, id); err != nil {
			return 0, err
		}
		if !active {
			if _, err := tx.ExecContext(ctx, "UPDATE sessions SET revoked_at=UTC_TIMESTAMP(6) WHERE user_id=? AND revoked_at IS NULL", id); err != nil {
				return 0, err
			}
		}
		return id, nil
	})
}
