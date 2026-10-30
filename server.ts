import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { errorHandler } from "./lib/http";
import { authRouter, usersRouter, settingsRouter, auditRouter } from "./routes/core";
import { membersRouter, savingsRouter } from "./routes/members";
import { loansRouter, installmentsRouter, expensesRouter, ledgerRouter, dashboardRouter, reportsRouter } from "./routes/finance";

const app = express();
app.use(helmet());
app.use(cors({ origin: (process.env.CORS_ORIGIN || "http://localhost:3000").split(",") }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/audit-logs", auditRouter);
app.use("/api/members", membersRouter);
app.use("/api/savings", savingsRouter);
app.use("/api/loans", loansRouter);
app.use("/api/installments", installmentsRouter);
app.use("/api/expenses", expensesRouter);
app.use("/api/ledger", ledgerRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/reports", reportsRouter);
app.use((_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

const port = Number(process.env.PORT) || 4000;
if (require.main === module) app.listen(port, () => console.log(`Samiti API listening on :${port}`));
export default app;
