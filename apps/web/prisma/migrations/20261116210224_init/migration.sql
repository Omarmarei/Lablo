-- CreateTable
CREATE TABLE "PairSession" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "tvPk" TEXT NOT NULL,
    "pollTokenHash" TEXT NOT NULL,
    "payload" JSONB,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PairSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Backup" (
    "lookupId" TEXT NOT NULL,
    "writeTokenHash" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Backup_pkey" PRIMARY KEY ("lookupId")
);

-- CreateTable
CREATE TABLE "TelemetryEvent" (
    "id" BIGSERIAL NOT NULL,
    "installId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelemetryEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiagReport" (
    "id" BIGSERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "installId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "appVersion" TEXT NOT NULL,
    "report" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiagReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PairSession_codeHash_key" ON "PairSession"("codeHash");

-- CreateIndex
CREATE INDEX "PairSession_expiresAt_idx" ON "PairSession"("expiresAt");

-- CreateIndex
CREATE INDEX "Backup_updatedAt_idx" ON "Backup"("updatedAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_receivedAt_idx" ON "TelemetryEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "TelemetryEvent_kind_receivedAt_idx" ON "TelemetryEvent"("kind", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DiagReport_code_key" ON "DiagReport"("code");

-- CreateIndex
CREATE INDEX "DiagReport_createdAt_idx" ON "DiagReport"("createdAt");
