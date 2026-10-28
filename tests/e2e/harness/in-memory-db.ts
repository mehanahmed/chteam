/**
 * In-Memory Stateful Database Emulator for E2E Tests
 * Location: tests/e2e/harness/in-memory-db.ts
 *
 * Emulates Kysely query builder and transactions for:
 * - contacts
 * - contact_assignments
 * - tags
 * - contact_tags
 * - messages
 * - catalog_products
 * - whatsapp_connections
 * - nats_outbox
 */

export interface ContactRecord {
  id: string;
  is_blocked?: boolean;
}

export interface ContactAssignmentRecord {
  contact_id: string;
  assigned_to: string;
  assigned_at: Date;
  unassigned_at?: Date | null;
}

export interface TagRecord {
  id: string;
  name: string;
  color?: string;
}

export interface ContactTagRecord {
  contact_id: string;
  tag_id: string;
}

export interface MessageRecord {
  id: string;
  whatsapp_connection_id?: string | null;
  contact_id: string;
  message_id?: string;
  from_me: boolean;
  sender_jid?: string | null;
  message_type?: string;
  content: string | null;
  sent_by_user_id?: string | null;
  status?: string;
  timestamp: Date;
  created_at: Date;
}

export interface CatalogProductRecord {
  id?: string;
  product_id: string;
  catalog_id?: string;
  name: string;
  description: string | null;
  price: number | null;
  currency?: string;
  image_urls?: string[] | null;
  sku: string | null;
  category: string | null;
  availability: string;
  visibility?: string;
}

export interface WhatsAppConnectionRecord {
  id: string;
  name: string;
  jid: string;
  archived_at?: Date | null;
}

export class InMemoryTestDatabase {
  public contacts = new Map<string, ContactRecord>();
  public contactAssignments: ContactAssignmentRecord[] = [];
  public tags = new Map<string, TagRecord>();
  public contactTags: ContactTagRecord[] = [];
  public messages: MessageRecord[] = [];
  public catalogProducts = new Map<string, CatalogProductRecord>();
  public whatsappConnections = new Map<string, WhatsAppConnectionRecord>();
  public natsOutbox: Array<Record<string, unknown>> = [];

  public readonly isTransaction = true;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.contacts.clear();
    this.contactAssignments = [];
    this.tags.clear();
    this.contactTags = [];
    this.messages = [];
    this.catalogProducts.clear();
    this.whatsappConnections.clear();
    this.natsOutbox = [];

    // Prepopulate default tags
    this.tags.set("tag-ai-paused", {
      id: "tag-ai-paused",
      name: "ai-paused",
      color: "#F59E0B",
    });
    this.tags.set("tag-needs-human", {
      id: "tag-needs-human",
      name: "needs-human",
      color: "#EF4444",
    });
    this.tags.set("tag-complaint", {
      id: "tag-complaint",
      name: "complaint",
      color: "#DC2626",
    });

    // Prepopulate default connection
    this.whatsappConnections.set("conn-e2e-1", {
      id: "conn-e2e-1",
      name: "OmniTeam Fashion",
      jid: "store@s.whatsapp.net",
      archived_at: null,
    });
  }

  public async executeQuery(
    _compiledQuery: unknown,
  ): Promise<{ rows: unknown[] }> {
    return { rows: [] };
  }

  public getExecutor() {
    return {
      transformQuery: (node: unknown) => node,
      compileQuery: (node: unknown) => ({
        sql: "",
        parameters: [],
        query: node,
      }),
      executeQuery: async () => ({ rows: [] }),
    };
  }

  public transaction() {
    return {
      execute: async (
        callback: (trx: InMemoryTestDatabase) => Promise<unknown>,
      ) => {
        return callback(this);
      },
    };
  }

  public selectFrom(table: string) {
    return new SelectQueryBuilder(this, table);
  }

  public insertInto(table: string) {
    return new InsertQueryBuilder(this, table);
  }

  public updateTable(table: string) {
    return new UpdateQueryBuilder(this, table);
  }

  public deleteFrom(table: string) {
    return new DeleteQueryBuilder(this, table);
  }
}

class SelectQueryBuilder {
  private db: InMemoryTestDatabase;
  private table: string;
  private selectedColumns: string[] | "all" = "all";
  private whereClauses: Array<{
    colOrCb: string | ((eb: unknown) => unknown);
    op?: string;
    val?: unknown;
  }> = [];
  private joins: Array<{
    targetTable: string;
    leftCol: string;
    rightCol: string;
  }> = [];
  private orderColumn?: string;
  private orderDir?: "asc" | "desc";
  private limitCount?: number;

  constructor(db: InMemoryTestDatabase, table: string) {
    this.db = db;
    this.table = table;
  }

  public select(cols: string | string[]): this {
    if (Array.isArray(cols)) {
      this.selectedColumns = cols;
    } else {
      this.selectedColumns = [cols];
    }
    return this;
  }

  public selectAll(): this {
    this.selectedColumns = "all";
    return this;
  }

  public innerJoin(
    targetTable: string,
    leftCol: string,
    rightCol: string,
  ): this {
    this.joins.push({ targetTable, leftCol, rightCol });
    return this;
  }

  public where(
    colOrCb: string | ((eb: unknown) => unknown),
    op?: string,
    val?: unknown,
  ): this {
    this.whereClauses.push({ colOrCb, op, val });
    return this;
  }

  public orderBy(col: string, dir: "asc" | "desc" = "asc"): this {
    this.orderColumn = col;
    this.orderDir = dir;
    return this;
  }

  public limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  public async execute(): Promise<any[]> {
    let rows: any[] = [];

    if (this.table === "contacts") {
      rows = Array.from(this.db.contacts.values());
    } else if (this.table === "contact_assignments") {
      rows = [...this.db.contactAssignments];
    } else if (this.table === "tags") {
      rows = Array.from(this.db.tags.values());
    } else if (this.table === "contact_tags") {
      rows = this.db.contactTags.map((ct) => {
        const tag = this.db.tags.get(ct.tag_id);
        return {
          contact_id: ct.contact_id,
          tag_id: ct.tag_id,
          "tags.id": tag?.id,
          "tags.name": tag?.name,
          "tags.color": tag?.color,
          name: tag?.name,
        };
      });
    } else if (this.table === "messages") {
      rows = [...this.db.messages];
    } else if (this.table === "whatsapp_connections") {
      rows = Array.from(this.db.whatsappConnections.values());
    } else if (this.table === "catalog_products") {
      rows = Array.from(this.db.catalogProducts.values());
    } else if (this.table === "nats_outbox") {
      rows = [...this.db.natsOutbox];
    }

    // Process joins
    for (const join of this.joins) {
      if (join.targetTable === "tags" && this.table === "contact_tags") {
        // already handled in contact_tags projection above
      }
    }

    // Apply where clauses
    for (const w of this.whereClauses) {
      if (typeof w.colOrCb === "string") {
        const col = w.colOrCb;
        const op = w.op?.toLowerCase();
        const val = w.val;

        rows = rows.filter((r) => {
          const actualVal =
            r[col] !== undefined
              ? r[col]
              : col.startsWith("contact_tags.")
                ? r[col.replace("contact_tags.", "")]
                : col.startsWith("tags.")
                  ? r[col.replace("tags.", "")]
                  : undefined;

          if (op === "=") {
            return String(actualVal) === String(val);
          }
          if (op === "is") {
            return val === null ? actualVal == null : actualVal === val;
          }
          if (op === "is not") {
            return val === null ? actualVal != null : actualVal !== val;
          }
          if (op === "ilike" || op === "like") {
            return String(actualVal || "")
              .toLowerCase()
              .includes(String(val || "").toLowerCase());
          }
          return true;
        });
      }
    }

    // Apply ordering
    if (this.orderColumn) {
      const col = this.orderColumn;
      const dir = this.orderDir === "desc" ? -1 : 1;
      rows.sort((a, b) => {
        const aVal = a[col];
        const bVal = b[col];
        if (aVal instanceof Date && bVal instanceof Date) {
          return (aVal.getTime() - bVal.getTime()) * dir;
        }
        if (aVal < bVal) return -1 * dir;
        if (aVal > bVal) return 1 * dir;
        return 0;
      });
    }

    // Apply limit
    if (this.limitCount !== undefined) {
      rows = rows.slice(0, this.limitCount);
    }

    // Apply projection
    if (this.selectedColumns !== "all") {
      const cols = this.selectedColumns;
      rows = rows.map((r) => {
        const projected: Record<string, any> = {};
        for (const col of cols) {
          if (col === "tags.name") {
            projected.name = r["tags.name"] || r.name;
          } else if (col === "tags.id") {
            projected.id = r["tags.id"] || r.id;
          } else {
            projected[col] = r[col];
          }
        }
        return projected;
      });
    }

    return rows;
  }

  public async executeTakeFirst(): Promise<any | undefined> {
    const list = await this.limit(1).execute();
    return list[0];
  }
}

class InsertQueryBuilder {
  private db: InMemoryTestDatabase;
  private table: string;
  private rowsToInsert: any[] = [];
  private returningCols: string[] = [];

  constructor(db: InMemoryTestDatabase, table: string) {
    this.db = db;
    this.table = table;
  }

  public values(val: any | any[]): this {
    if (Array.isArray(val)) {
      this.rowsToInsert = [...val];
    } else {
      this.rowsToInsert = [val];
    }
    return this;
  }

  public returning(cols: string | string[]): this {
    if (Array.isArray(cols)) {
      this.returningCols = cols;
    } else {
      this.returningCols = [cols];
    }
    return this;
  }

  public async execute(): Promise<any> {
    for (const item of this.rowsToInsert) {
      if (this.table === "contacts") {
        this.db.contacts.set(item.id, { ...item });
      } else if (this.table === "contact_assignments") {
        this.db.contactAssignments.push({
          ...item,
          assigned_at: item.assigned_at || new Date(),
        });
      } else if (this.table === "tags") {
        const id =
          item.id ||
          `tag-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        this.db.tags.set(id, { ...item, id });
      } else if (this.table === "contact_tags") {
        const exists = this.db.contactTags.some(
          (ct) =>
            ct.contact_id === item.contact_id && ct.tag_id === item.tag_id,
        );
        if (!exists) {
          this.db.contactTags.push({ ...item });
        }
      } else if (this.table === "messages") {
        this.db.messages.push({
          ...item,
          timestamp: item.timestamp || new Date(),
          created_at: item.created_at || new Date(),
        });
      } else if (this.table === "whatsapp_connections") {
        this.db.whatsappConnections.set(item.id, { ...item });
      } else if (this.table === "catalog_products") {
        this.db.catalogProducts.set(item.product_id, { ...item });
      } else if (this.table === "nats_outbox") {
        this.db.natsOutbox.push({ ...item });
      }
    }
    return { insertId: 1 };
  }

  public async executeTakeFirst(): Promise<any> {
    await this.execute();
    const first = this.rowsToInsert[0];
    if (first && this.returningCols.length > 0) {
      const res: Record<string, any> = {};
      for (const col of this.returningCols) {
        res[col] =
          first[col] || (col === "id" ? `gen-${Date.now()}` : undefined);
      }
      return res;
    }
    return first;
  }
}

class UpdateQueryBuilder {
  private db: InMemoryTestDatabase;
  private table: string;
  private updates: Record<string, any> = {};
  private whereClauses: Array<{ col: string; op?: string; val?: any }> = [];

  constructor(db: InMemoryTestDatabase, table: string) {
    this.db = db;
    this.table = table;
  }

  public set(updates: Record<string, any>): this {
    this.updates = updates;
    return this;
  }

  public where(col: string, op?: string, val?: any): this {
    this.whereClauses.push({ col, op, val });
    return this;
  }

  public async execute(): Promise<any> {
    if (this.table === "contacts") {
      for (const [id, c] of this.db.contacts.entries()) {
        let match = true;
        for (const w of this.whereClauses) {
          if (w.col === "id" && w.val !== id) match = false;
        }
        if (match) {
          this.db.contacts.set(id, { ...c, ...this.updates });
        }
      }
    } else if (this.table === "catalog_products") {
      for (const [id, p] of this.db.catalogProducts.entries()) {
        let match = true;
        for (const w of this.whereClauses) {
          if (w.col === "product_id" && w.val !== id) match = false;
        }
        if (match) {
          this.db.catalogProducts.set(id, { ...p, ...this.updates });
        }
      }
    }
    return { numUpdatedRows: 1 };
  }
}

class DeleteQueryBuilder {
  private db: InMemoryTestDatabase;
  private table: string;
  private whereClauses: Array<{ col: string; op?: string; val?: any }> = [];

  constructor(db: InMemoryTestDatabase, table: string) {
    this.db = db;
    this.table = table;
  }

  public where(col: string, op?: string, val?: any): this {
    this.whereClauses.push({ col, op, val });
    return this;
  }

  public async execute(): Promise<any> {
    if (this.table === "contact_tags") {
      let filtered = [...this.db.contactTags];
      for (const w of this.whereClauses) {
        if (w.col === "contact_id") {
          filtered = filtered.filter((ct) => ct.contact_id !== w.val);
        } else if (w.col === "tag_id") {
          filtered = filtered.filter((ct) => ct.tag_id !== w.val);
        }
      }
      this.db.contactTags = filtered;
    } else if (this.table === "catalog_products") {
      this.db.catalogProducts.clear();
    }
    return { numDeletedRows: 1 };
  }
}
