-- AlterTable
ALTER TABLE "Clause" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "category" TEXT,
ADD COLUMN     "guidance" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedById" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Court" ADD COLUMN     "appealDayKind" TEXT NOT NULL DEFAULT 'CALENDAR',
ADD COLUMN     "appealDays" INTEGER;

-- AlterTable
ALTER TABLE "Hearing" ADD COLUMN     "reminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Outcome" ADD COLUMN     "appealDayKind" TEXT,
ADD COLUMN     "appealDays" INTEGER,
ADD COLUMN     "appealDeadlineId" TEXT,
ADD COLUMN     "appealDecision" TEXT,
ADD COLUMN     "appealFrom" TIMESTAMP(3),
ADD COLUMN     "complyBy" TIMESTAMP(3),
ADD COLUMN     "complyDeadlineId" TEXT;

-- AlterTable
ALTER TABLE "ReportTemplate" ADD COLUMN     "autoSend" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastSentRef" TEXT,
ADD COLUMN     "recipientIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "Template" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT,
ADD COLUMN     "guidance" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'CONTRACT',
ADD COLUMN     "updatedById" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "LibraryVersion" (
    "id" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "changedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LibraryVersion_itemType_itemId_version_key" ON "LibraryVersion"("itemType", "itemId", "version");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

