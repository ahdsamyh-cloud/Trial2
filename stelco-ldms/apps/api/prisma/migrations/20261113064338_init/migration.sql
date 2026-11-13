-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('LIT', 'CMP', 'DRF', 'AWR');

-- CreateEnum
CREATE TYPE "RoleCode" AS ENUM ('SUPER_ADMIN', 'HOD', 'UNIT_HEAD', 'LEGAL_OFFICER', 'PARALEGAL', 'REQUESTER', 'AUDITOR', 'MGMT_VIEWER');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_SETUP', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "Priority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TokenPurpose" AS ENUM ('SETUP', 'RESET');

-- CreateEnum
CREATE TYPE "IdentityProvider" AS ENUM ('LOCAL', 'ENTRA');

-- CreateEnum
CREATE TYPE "IntakeSourceKind" AS ENUM ('EMAIL', 'LETTER', 'PHONE', 'WALKIN', 'PORTAL');

-- CreateEnum
CREATE TYPE "IntakeAdapter" AS ENUM ('MANUAL', 'PORTAL', 'GRAPH');

-- CreateEnum
CREATE TYPE "AssignmentRole" AS ENUM ('ASSIGNEE', 'REVIEWER', 'APPROVER', 'WATCHER');

-- CreateEnum
CREATE TYPE "ScanStatus" AS ENUM ('PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "SlaUnit" AS ENUM ('BUSINESS', 'CALENDAR');

-- CreateEnum
CREATE TYPE "Digest" AS ENUM ('NONE', 'DAILY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'PREVIEWED', 'COMMITTED', 'ROLLED_BACK', 'FAILED');

-- CreateEnum
CREATE TYPE "RiskRating" AS ENUM ('PROBABLE', 'POSSIBLE', 'REMOTE');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "departmentId" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_SETUP',
    "isAdminAccount" BOOLEAN NOT NULL DEFAULT false,
    "accessExpiresAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lockoutCount24h" INTEGER NOT NULL DEFAULT 0,
    "lastLockoutAt" TIMESTAMP(3),
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Identity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "IdentityProvider" NOT NULL,
    "subject" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Identity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocalCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocalCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "MfaFactor" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'TOTP',
    "secretEnc" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "lastStep" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MfaFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'PENDING_MFA',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "absoluteExpiry" TIMESTAMP(3) NOT NULL,
    "reauthAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "mobile" BOOLEAN NOT NULL DEFAULT false,
    "deviceId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "label" TEXT,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnownDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "RoleCode" NOT NULL,
    "unit" "Unit",
    "expiresAt" TIMESTAMP(3),
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OneTimeToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OneTimeToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginThrottle" (
    "key" TEXT NOT NULL,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "windowAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginThrottle_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "seq" BIGSERIAL NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "actorName" TEXT,
    "sessionId" TEXT,
    "ip" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
    "before" JSONB,
    "after" JSONB,
    "meta" JSONB,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("seq")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "matterId" TEXT,
    "readAt" TIMESTAMP(3),
    "digested" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPref" (
    "userId" TEXT NOT NULL,
    "email" BOOLEAN NOT NULL DEFAULT true,
    "digest" "Digest" NOT NULL DEFAULT 'DAILY',

    CONSTRAINT "NotificationPref_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPolicy" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "target" INTEGER NOT NULL,
    "unit" "SlaUnit" NOT NULL DEFAULT 'BUSINESS',
    "urgentHalves" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlaPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestType" (
    "id" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slaPolicyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RequestType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusDefinition" (
    "id" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isTerminal" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "StatusDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentType" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" "Unit",

    CONSTRAINT "DocumentType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LawFirm" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "LawFirm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalLawyer" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,

    CONSTRAINT "ExternalLawyer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Regulator" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,

    CONSTRAINT "Regulator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Court" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'COURT',
    "jurisdiction" TEXT,

    CONSTRAINT "Court_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "years" INTEGER NOT NULL,
    "trigger" TEXT NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceSequence" (
    "prefix" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReferenceSequence_pkey" PRIMARY KEY ("prefix","year")
);

-- CreateTable
CREATE TABLE "Intake" (
    "id" TEXT NOT NULL,
    "intakeNo" TEXT NOT NULL,
    "source" "IntakeSourceKind" NOT NULL,
    "adapter" "IntakeAdapter" NOT NULL DEFAULT 'MANUAL',
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "senderName" TEXT NOT NULL,
    "senderEmail" TEXT,
    "senderDeptId" TEXT,
    "subject" TEXT NOT NULL,
    "summary" TEXT,
    "emailRef" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "suggestedUnit" "Unit",
    "matterId" TEXT,
    "duplicateOfId" TEXT,
    "assigneeId" TEXT,
    "triageNote" TEXT,
    "submittedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Intake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailMessage" (
    "id" TEXT NOT NULL,
    "intakeId" TEXT NOT NULL,
    "adapter" "IntakeAdapter" NOT NULL DEFAULT 'MANUAL',
    "internetMessageId" TEXT,
    "graphMessageId" TEXT,
    "conversationId" TEXT,
    "fromName" TEXT,
    "fromAddr" TEXT,
    "to" JSONB,
    "cc" JSONB,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "subject" TEXT,
    "bodyText" TEXT,
    "bodyHtmlSanitized" TEXT,
    "originalDocId" TEXT,

    CONSTRAINT "EmailMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matter" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "requestTypeId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "descriptionEnc" TEXT,
    "status" TEXT NOT NULL,
    "priority" "Priority" NOT NULL DEFAULT 'NORMAL',
    "requestingDeptId" TEXT,
    "requesterId" TEXT,
    "requesterName" TEXT,
    "dueDate" TIMESTAMP(3),
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importBatchId" TEXT,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "searchText" TEXT,

    CONSTRAINT "Matter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterAssignment" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AssignmentRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterAccess" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusTransition" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "comment" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatusTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT,
    "bodyEnc" TEXT,
    "mentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "internal" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterLink" (
    "id" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'RELATED',

    CONSTRAINT "MatterLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaClock" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "policyId" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "warnedAt" TIMESTAMP(3),
    "breachedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "ownerId" TEXT,

    CONSTRAINT "SlaClock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlaPause" (
    "id" TEXT NOT NULL,
    "clockId" TEXT NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3),
    "reason" TEXT,

    CONSTRAINT "SlaPause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "docTypeCode" TEXT,
    "matterId" TEXT,
    "intakeId" TEXT,
    "hearingId" TEXT,
    "lawId" TEXT,
    "checkItemId" TEXT,
    "findingId" TEXT,
    "sessionId" TEXT,
    "contractId" TEXT,
    "poaId" TEXT,
    "templateId" TEXT,
    "libraryKind" TEXT,
    "currentVersionNo" INTEGER NOT NULL DEFAULT 0,
    "checkedOutById" TEXT,
    "checkedOutAt" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "sharedToPortal" BOOLEAN NOT NULL DEFAULT false,
    "submittedToCourtOn" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "stageLabel" TEXT,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "detectedMime" TEXT NOT NULL,
    "scanStatus" "ScanStatus" NOT NULL DEFAULT 'PENDING',
    "scanDetail" TEXT,
    "extractedText" TEXT,
    "ocrApplied" BOOLEAN NOT NULL DEFAULT false,
    "comment" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentAccessLog" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "ip" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentAccessLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalHold" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "placedById" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,

    CONSTRAINT "LegalHold_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisposalRequest" (
    "id" TEXT NOT NULL,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DisposalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CalendarEvent" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "unit" "Unit" NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT,
    "matterId" TEXT,
    "restricted" BOOLEAN NOT NULL DEFAULT false,
    "location" TEXT,
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CalendarEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "offsetDays" INTEGER NOT NULL,
    "sendAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportMapping" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "columnMap" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "columnMap" JSONB,
    "options" JSONB,
    "stats" JSONB,
    "headers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "rolledBackAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNo" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "errors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "warnings" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "action" TEXT NOT NULL,
    "entityId" TEXT,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LitigationCase" (
    "matterId" TEXT NOT NULL,
    "courtCaseNo" TEXT,
    "courtId" TEXT,
    "jurisdiction" TEXT,
    "caseType" TEXT NOT NULL,
    "ourRole" TEXT NOT NULL,
    "subject" TEXT,
    "externalFirmId" TEXT,
    "externalLawyerId" TEXT,
    "responsibleOfficerId" TEXT,
    "claimAmount" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'MVR',
    "filingDate" TIMESTAMP(3),
    "risk" "RiskRating",
    "exposureEnc" TEXT,
    "remarks" TEXT,
    "lastUpdateAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "noUpdateFlaggedAt" TIMESTAMP(3),

    CONSTRAINT "LitigationCase_pkey" PRIMARY KEY ("matterId")
);

-- CreateTable
CREATE TABLE "CaseParty" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "counsel" TEXT,

    CONSTRAINT "CaseParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hearing" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "courtId" TEXT,
    "judge" TEXT,
    "purpose" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "attendees" JSONB,
    "summary" JSONB,
    "outcome" TEXT,
    "summaryEnteredAt" TIMESTAMP(3),
    "summaryById" TEXT,
    "nextHearingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hearing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseDeadline" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CaseDeadline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Engagement" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "feeArrangement" TEXT,
    "budget" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'MVR',
    "startedOn" TIMESTAMP(3),

    CONSTRAINT "Engagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounselInvoice" (
    "id" TEXT NOT NULL,
    "engagementId" TEXT NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MVR',
    "receivedOn" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "verifiedById" TEXT,
    "notes" TEXT,

    CONSTRAINT "CounselInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CounselUpdate" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "channel" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "enteredById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CounselUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FirmEvaluation" (
    "caseId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "quality" INTEGER NOT NULL,
    "responsiveness" INTEGER NOT NULL,
    "cost" INTEGER NOT NULL,
    "outcome" INTEGER NOT NULL,
    "comments" TEXT,
    "evaluatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirmEvaluation_pkey" PRIMARY KEY ("caseId")
);

-- CreateTable
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL,
    "caseId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "decidedOn" TIMESTAMP(3) NOT NULL,
    "amountEnc" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'MVR',
    "direction" TEXT NOT NULL,
    "paymentStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "terms" TEXT,

    CONSTRAINT "Outcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EnforcementAction" (
    "id" TEXT NOT NULL,
    "outcomeId" TEXT NOT NULL,
    "on" TIMESTAMP(3) NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "EnforcementAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftingRequest" (
    "matterId" TEXT NOT NULL,
    "counterparty" TEXT,
    "contractValue" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'MVR',
    "approvalLevel" TEXT NOT NULL DEFAULT 'UNIT_HEAD',
    "escalationReason" TEXT,
    "drafterId" TEXT,
    "reviewerId" TEXT,
    "followUpDate" TIMESTAMP(3),
    "ackText" TEXT,

    CONSTRAINT "DraftingRequest_pkey" PRIMARY KEY ("matterId")
);

-- CreateTable
CREATE TABLE "ReviewRound" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "submittedVersionId" TEXT,
    "decision" TEXT,
    "comments" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewRound_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Approval" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "approverId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Approval_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "body" TEXT,
    "documentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clause" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contract" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "title" TEXT NOT NULL,
    "parties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "value" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'MVR',
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "noticePeriodDays" INTEGER,
    "ownerDeptId" TEXT,
    "keyObligations" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PowerOfAttorney" (
    "id" TEXT NOT NULL,
    "holderName" TEXT NOT NULL,
    "holderUserId" TEXT,
    "scope" TEXT NOT NULL,
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "expiresOn" TIMESTAMP(3),
    "revokedOn" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "matterId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PowerOfAttorney_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegalOpinion" (
    "id" TEXT NOT NULL,
    "matterId" TEXT,
    "title" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "issuedOn" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LegalOpinion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Law" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "regulatorId" TEXT,
    "issuedOn" TIMESTAMP(3),
    "effectiveOn" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'IN_FORCE',
    "sourceUrl" TEXT,
    "summary" TEXT,
    "officerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Law_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LawVersion" (
    "id" TEXT NOT NULL,
    "lawId" TEXT NOT NULL,
    "versionNo" INTEGER NOT NULL,
    "notes" TEXT,
    "effectiveOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LawVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Obligation" (
    "id" TEXT NOT NULL,
    "lawId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "article" TEXT,
    "frequency" TEXT NOT NULL,
    "evidenceRequired" TEXT,
    "risk" "Severity" NOT NULL DEFAULT 'MEDIUM',
    "penalty" TEXT,
    "ownerId" TEXT,
    "departmentIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextCheckAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Obligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegulatoryChange" (
    "id" TEXT NOT NULL,
    "lawId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "impact" TEXT,
    "affectedDeptIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "officerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'IDENTIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RegulatoryChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dissemination" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "lawId" TEXT,
    "obligationId" TEXT,
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Dissemination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisseminationRecipient" (
    "id" TEXT NOT NULL,
    "disseminationId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "remindersSent" INTEGER NOT NULL DEFAULT 0,
    "lastReminderAt" TIMESTAMP(3),

    CONSTRAINT "DisseminationRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckCycle" (
    "id" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ISSUED',
    "submittedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckItem" (
    "id" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "obligationId" TEXT NOT NULL,
    "response" TEXT,
    "respondedById" TEXT,
    "rating" TEXT,
    "reviewerId" TEXT,
    "reviewNote" TEXT,

    CONSTRAINT "CheckItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" TEXT NOT NULL,
    "checkItemId" TEXT,
    "departmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "actionPlan" TEXT,
    "ownerId" TEXT,
    "dueOn" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FindingAction" (
    "id" TEXT NOT NULL,
    "findingId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FindingAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Licence" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "regulatorId" TEXT,
    "number" TEXT,
    "issuedOn" TIMESTAMP(3),
    "expiresOn" TIMESTAMP(3),
    "ownerDeptId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Licence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AwarenessPlan" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',

    CONSTRAINT "AwarenessPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "targetDeptIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "quarter" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AwarenessSession" (
    "id" TEXT NOT NULL,
    "planItemId" TEXT,
    "title" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "venue" TEXT,
    "meetingUrl" TEXT,
    "audienceDeptIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "presenterIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preparerIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "checkinSecret" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AwarenessSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "staffNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "departmentId" TEXT,
    "userId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackResponse" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comments" TEXT,
    "quizScore" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizQuestion" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "options" TEXT[],
    "answer" INTEGER NOT NULL,

    CONSTRAINT "QuizQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Bulletin" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'BULLETIN',
    "audienceDeptIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Bulletin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FaqEntry" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FaqEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Department_code_key" ON "Department"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_status_idx" ON "User"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Identity_provider_subject_key" ON "Identity"("provider", "subject");

-- CreateIndex
CREATE INDEX "MfaFactor_userId_idx" ON "MfaFactor"("userId");

-- CreateIndex
CREATE INDEX "BackupCode_userId_idx" ON "BackupCode"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "KnownDevice_userId_deviceHash_key" ON "KnownDevice"("userId", "deviceHash");

-- CreateIndex
CREATE UNIQUE INDEX "UserRole_userId_role_unit_key" ON "UserRole"("userId", "role", "unit");

-- CreateIndex
CREATE UNIQUE INDEX "OneTimeToken_tokenHash_key" ON "OneTimeToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "AuditLog_hash_key" ON "AuditLog"("hash");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_actorId_ts_idx" ON "AuditLog"("actorId", "ts");

-- CreateIndex
CREATE INDEX "AuditLog_action_ts_idx" ON "AuditLog"("action", "ts");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "EmailOutbox_status_idx" ON "EmailOutbox"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_date_key" ON "Holiday"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SlaPolicy_code_key" ON "SlaPolicy"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RequestType_code_key" ON "RequestType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "StatusDefinition_unit_code_key" ON "StatusDefinition"("unit", "code");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplate_code_key" ON "EmailTemplate"("code");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentType_code_key" ON "DocumentType"("code");

-- CreateIndex
CREATE UNIQUE INDEX "LawFirm_name_key" ON "LawFirm"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalLawyer_firmId_name_key" ON "ExternalLawyer"("firmId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Regulator_name_key" ON "Regulator"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Court_name_key" ON "Court"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_recordType_key" ON "RetentionPolicy"("recordType");

-- CreateIndex
CREATE UNIQUE INDEX "Intake_intakeNo_key" ON "Intake"("intakeNo");

-- CreateIndex
CREATE INDEX "Intake_status_receivedAt_idx" ON "Intake"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_intakeId_key" ON "EmailMessage"("intakeId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailMessage_internetMessageId_key" ON "EmailMessage"("internetMessageId");

-- CreateIndex
CREATE INDEX "EmailMessage_conversationId_idx" ON "EmailMessage"("conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Matter_reference_key" ON "Matter"("reference");

-- CreateIndex
CREATE INDEX "Matter_unit_status_idx" ON "Matter"("unit", "status");

-- CreateIndex
CREATE INDEX "Matter_requestingDeptId_idx" ON "Matter"("requestingDeptId");

-- CreateIndex
CREATE INDEX "MatterAssignment_userId_role_idx" ON "MatterAssignment"("userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "MatterAssignment_matterId_userId_role_key" ON "MatterAssignment"("matterId", "userId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "MatterAccess_matterId_userId_key" ON "MatterAccess"("matterId", "userId");

-- CreateIndex
CREATE INDEX "StatusTransition_matterId_at_idx" ON "StatusTransition"("matterId", "at");

-- CreateIndex
CREATE INDEX "Comment_matterId_idx" ON "Comment"("matterId");

-- CreateIndex
CREATE UNIQUE INDEX "MatterLink_fromId_toId_key" ON "MatterLink"("fromId", "toId");

-- CreateIndex
CREATE INDEX "SlaClock_stoppedAt_idx" ON "SlaClock"("stoppedAt");

-- CreateIndex
CREATE INDEX "SlaClock_subjectType_subjectId_idx" ON "SlaClock"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "Document_matterId_idx" ON "Document"("matterId");

-- CreateIndex
CREATE INDEX "Document_intakeId_idx" ON "Document"("intakeId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_storageKey_key" ON "DocumentVersion"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_versionNo_key" ON "DocumentVersion"("documentId", "versionNo");

-- CreateIndex
CREATE INDEX "DocumentAccessLog_versionId_idx" ON "DocumentAccessLog"("versionId");

-- CreateIndex
CREATE INDEX "CalendarEvent_startsAt_idx" ON "CalendarEvent"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEvent_sourceType_sourceId_kind_key" ON "CalendarEvent"("sourceType", "sourceId", "kind");

-- CreateIndex
CREATE INDEX "Reminder_sentAt_sendAt_idx" ON "Reminder"("sentAt", "sendAt");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_eventId_offsetDays_key" ON "Reminder"("eventId", "offsetDays");

-- CreateIndex
CREATE UNIQUE INDEX "ImportMapping_kind_name_key" ON "ImportMapping"("kind", "name");

-- CreateIndex
CREATE INDEX "ImportRow_batchId_idx" ON "ImportRow"("batchId");

-- CreateIndex
CREATE INDEX "LitigationCase_courtCaseNo_idx" ON "LitigationCase"("courtCaseNo");

-- CreateIndex
CREATE INDEX "Hearing_startsAt_idx" ON "Hearing"("startsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CounselInvoice_engagementId_invoiceNo_key" ON "CounselInvoice"("engagementId", "invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "Template_name_key" ON "Template"("name");

-- CreateIndex
CREATE UNIQUE INDEX "LawVersion_lawId_versionNo_key" ON "LawVersion"("lawId", "versionNo");

-- CreateIndex
CREATE UNIQUE INDEX "DisseminationRecipient_disseminationId_departmentId_key" ON "DisseminationRecipient"("disseminationId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "CheckCycle_departmentId_period_key" ON "CheckCycle"("departmentId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "CheckItem_cycleId_obligationId_key" ON "CheckItem"("cycleId", "obligationId");

-- CreateIndex
CREATE UNIQUE INDEX "AwarenessPlan_year_key" ON "AwarenessPlan"("year");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_staffNo_key" ON "Employee"("staffNo");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_userId_key" ON "Employee"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_sessionId_employeeId_key" ON "Attendance"("sessionId", "employeeId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Identity" ADD CONSTRAINT "Identity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocalCredential" ADD CONSTRAINT "LocalCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MfaFactor" ADD CONSTRAINT "MfaFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupCode" ADD CONSTRAINT "BackupCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownDevice" ADD CONSTRAINT "KnownDevice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OneTimeToken" ADD CONSTRAINT "OneTimeToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPref" ADD CONSTRAINT "NotificationPref_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestType" ADD CONSTRAINT "RequestType_slaPolicyId_fkey" FOREIGN KEY ("slaPolicyId") REFERENCES "SlaPolicy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalLawyer" ADD CONSTRAINT "ExternalLawyer_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "LawFirm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intake" ADD CONSTRAINT "Intake_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailMessage" ADD CONSTRAINT "EmailMessage_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_requestTypeId_fkey" FOREIGN KEY ("requestTypeId") REFERENCES "RequestType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterAssignment" ADD CONSTRAINT "MatterAssignment_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterAssignment" ADD CONSTRAINT "MatterAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterAccess" ADD CONSTRAINT "MatterAccess_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterAccess" ADD CONSTRAINT "MatterAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusTransition" ADD CONSTRAINT "StatusTransition_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterLink" ADD CONSTRAINT "MatterLink_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterLink" ADD CONSTRAINT "MatterLink_toId_fkey" FOREIGN KEY ("toId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaClock" ADD CONSTRAINT "SlaClock_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaClock" ADD CONSTRAINT "SlaClock_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "SlaPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlaPause" ADD CONSTRAINT "SlaPause_clockId_fkey" FOREIGN KEY ("clockId") REFERENCES "SlaClock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_intakeId_fkey" FOREIGN KEY ("intakeId") REFERENCES "Intake"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_hearingId_fkey" FOREIGN KEY ("hearingId") REFERENCES "Hearing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_lawId_fkey" FOREIGN KEY ("lawId") REFERENCES "Law"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_checkItemId_fkey" FOREIGN KEY ("checkItemId") REFERENCES "CheckItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AwarenessSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "Contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_poaId_fkey" FOREIGN KEY ("poaId") REFERENCES "PowerOfAttorney"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentAccessLog" ADD CONSTRAINT "DocumentAccessLog_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CalendarEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitigationCase" ADD CONSTRAINT "LitigationCase_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitigationCase" ADD CONSTRAINT "LitigationCase_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitigationCase" ADD CONSTRAINT "LitigationCase_externalFirmId_fkey" FOREIGN KEY ("externalFirmId") REFERENCES "LawFirm"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LitigationCase" ADD CONSTRAINT "LitigationCase_externalLawyerId_fkey" FOREIGN KEY ("externalLawyerId") REFERENCES "ExternalLawyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseParty" ADD CONSTRAINT "CaseParty_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LitigationCase"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LitigationCase"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hearing" ADD CONSTRAINT "Hearing_courtId_fkey" FOREIGN KEY ("courtId") REFERENCES "Court"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseDeadline" ADD CONSTRAINT "CaseDeadline_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LitigationCase"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LitigationCase"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Engagement" ADD CONSTRAINT "Engagement_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "LawFirm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselInvoice" ADD CONSTRAINT "CounselInvoice_engagementId_fkey" FOREIGN KEY ("engagementId") REFERENCES "Engagement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CounselUpdate" ADD CONSTRAINT "CounselUpdate_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LitigationCase"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirmEvaluation" ADD CONSTRAINT "FirmEvaluation_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LitigationCase"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FirmEvaluation" ADD CONSTRAINT "FirmEvaluation_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "LawFirm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Outcome" ADD CONSTRAINT "Outcome_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "LitigationCase"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EnforcementAction" ADD CONSTRAINT "EnforcementAction_outcomeId_fkey" FOREIGN KEY ("outcomeId") REFERENCES "Outcome"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftingRequest" ADD CONSTRAINT "DraftingRequest_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewRound" ADD CONSTRAINT "ReviewRound_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "DraftingRequest"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Approval" ADD CONSTRAINT "Approval_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "DraftingRequest"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contract" ADD CONSTRAINT "Contract_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LegalOpinion" ADD CONSTRAINT "LegalOpinion_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Law" ADD CONSTRAINT "Law_regulatorId_fkey" FOREIGN KEY ("regulatorId") REFERENCES "Regulator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LawVersion" ADD CONSTRAINT "LawVersion_lawId_fkey" FOREIGN KEY ("lawId") REFERENCES "Law"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Obligation" ADD CONSTRAINT "Obligation_lawId_fkey" FOREIGN KEY ("lawId") REFERENCES "Law"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegulatoryChange" ADD CONSTRAINT "RegulatoryChange_lawId_fkey" FOREIGN KEY ("lawId") REFERENCES "Law"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dissemination" ADD CONSTRAINT "Dissemination_lawId_fkey" FOREIGN KEY ("lawId") REFERENCES "Law"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisseminationRecipient" ADD CONSTRAINT "DisseminationRecipient_disseminationId_fkey" FOREIGN KEY ("disseminationId") REFERENCES "Dissemination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckItem" ADD CONSTRAINT "CheckItem_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "CheckCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckItem" ADD CONSTRAINT "CheckItem_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "Obligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_checkItemId_fkey" FOREIGN KEY ("checkItemId") REFERENCES "CheckItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FindingAction" ADD CONSTRAINT "FindingAction_findingId_fkey" FOREIGN KEY ("findingId") REFERENCES "Finding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Licence" ADD CONSTRAINT "Licence_regulatorId_fkey" FOREIGN KEY ("regulatorId") REFERENCES "Regulator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AwarenessPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AwarenessSession" ADD CONSTRAINT "AwarenessSession_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "PlanItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AwarenessSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackResponse" ADD CONSTRAINT "FeedbackResponse_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AwarenessSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizQuestion" ADD CONSTRAINT "QuizQuestion_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "AwarenessSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
