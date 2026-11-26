-- AlterTable
ALTER TABLE "CheckItem" ADD COLUMN     "answer" TEXT,
ADD COLUMN     "answeredAt" TIMESTAMP(3),
ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "lastReminderAt" TIMESTAMP(3),
ADD COLUMN     "reminderCount" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "versionId" TEXT;

-- AlterTable
ALTER TABLE "Hearing" ADD COLUMN     "chitSummary" TEXT,
ADD COLUMN     "continuanceNote" TEXT,
ADD COLUMN     "continuanceRequestedAt" TIMESTAMP(3),
ADD COLUMN     "continuanceStatus" TEXT,
ADD COLUMN     "postponeReason" TEXT;

-- AlterTable
ALTER TABLE "Law" ADD COLUMN     "researchAssignedAt" TIMESTAMP(3),
ADD COLUMN     "researchAssignedById" TEXT,
ADD COLUMN     "researchAssigneeId" TEXT,
ADD COLUMN     "researchCompletedAt" TIMESTAMP(3),
ADD COLUMN     "researchDueAt" TIMESTAMP(3),
ADD COLUMN     "researchFindings" TEXT,
ADD COLUMN     "researchNote" TEXT,
ADD COLUMN     "researchStatus" TEXT;

-- CreateTable
CREATE TABLE "DraftingExternal" (
    "id" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "lawyerId" TEXT,
    "scope" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "fee" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'MVR',
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftingExternal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "period" TEXT NOT NULL DEFAULT 'ANY',
    "format" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReportTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DraftingExternal_matterId_idx" ON "DraftingExternal"("matterId");

-- CreateIndex
CREATE UNIQUE INDEX "ReportTemplate_documentId_key" ON "ReportTemplate"("documentId");

-- AddForeignKey
ALTER TABLE "DraftingExternal" ADD CONSTRAINT "DraftingExternal_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "DraftingRequest"("matterId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftingExternal" ADD CONSTRAINT "DraftingExternal_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "LawFirm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftingExternal" ADD CONSTRAINT "DraftingExternal_lawyerId_fkey" FOREIGN KEY ("lawyerId") REFERENCES "ExternalLawyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

