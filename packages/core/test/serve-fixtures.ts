import { TransactionProvider } from "../repository/postgres/db"
import { LedgerRepository } from "../repository/postgres/ledger.repository"
import { LinksRepository } from "../repository/postgres/links.repository"
import { VisibilityRepository } from "../repository/postgres/visibility.repository"
import { LedgerService } from "../services/ledger/ledger.service"
import { ServeService } from "../services/serve/serve.service"

import type { Sql } from "postgres"

/** The production wiring of `ServeService`, against one test database. */
export const buildServeService = (sql: Sql): ServeService =>
	new ServeService(
		new VisibilityRepository(sql),
		new LedgerService(new LedgerRepository(sql)),
		new TransactionProvider(sql),
		new LinksRepository(sql),
	)
