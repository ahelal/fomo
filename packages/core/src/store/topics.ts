import { odata, type TableClient, type TableEntity } from '@azure/data-tables';
import { createTableClient, isSasConnection } from './connection.js';
import { isTableError } from './tables.js';
import { TOPIC_IMPORTANCE, type StoreConnection, type Topic, type TopicImportance } from '../types.js';

const TOPIC_TABLE = 'topics';
const TOPIC_PK = 'topic';
/** Azure Table Storage allows at most 15 discrete comparisons per filter. */
const MAX_FILTER_COMPARISONS = 15;

type TopicEntity = TableEntity<{
  title: string;
  summary: string;
  /** JSON-encoded string[] */
  highlights: string;
  importance?: string;
  createdAt: string;
  updatedAt: string;
}>;

function entityToTopic(e: TopicEntity): Topic {
  let highlights: string[] = [];
  try {
    const parsed: unknown = JSON.parse(e.highlights || '[]');
    if (Array.isArray(parsed)) highlights = parsed.filter((h): h is string => typeof h === 'string');
  } catch {
    // corrupt row — show without highlights
  }
  const topic: Topic = {
    id: e.rowKey,
    title: e.title,
    summary: e.summary ?? '',
    highlights,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
  if (TOPIC_IMPORTANCE.includes(e.importance as TopicImportance)) topic.importance = e.importance as TopicImportance;
  return topic;
}

export class TopicStore {
  private readonly client: TableClient;
  private readonly canCreateTables: boolean;

  constructor(conn: StoreConnection) {
    this.client = createTableClient(conn, TOPIC_TABLE);
    this.canCreateTables = !isSasConnection(conn);
  }

  async init(): Promise<void> {
    if (!this.canCreateTables) return;
    await this.client.createTable();
  }

  /** Fetch topics by id (missing ids are skipped). */
  async getTopics(ids: string[]): Promise<Map<string, Topic>> {
    const unique = [...new Set(ids.filter(Boolean))];
    const out = new Map<string, Topic>();
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += MAX_FILTER_COMPARISONS - 1) {
      chunks.push(unique.slice(i, i + MAX_FILTER_COMPARISONS - 1));
    }
    await Promise.all(
      chunks.map(async (chunk) => {
        const rowFilter = chunk.map((id) => odata`RowKey eq ${id}`).join(' or ');
        const filter = `${odata`PartitionKey eq ${TOPIC_PK}`} and (${rowFilter})`;
        for await (const e of this.client.listEntities<TopicEntity>({ queryOptions: { filter } })) {
          const topic = entityToTopic(e as TopicEntity);
          out.set(topic.id, topic);
        }
      }),
    );
    return out;
  }

  async listTopics(): Promise<Topic[]> {
    const topics: Topic[] = [];
    const filter = odata`PartitionKey eq ${TOPIC_PK}`;
    for await (const e of this.client.listEntities<TopicEntity>({ queryOptions: { filter } })) {
      topics.push(entityToTopic(e as TopicEntity));
    }
    return topics;
  }

  async upsertTopic(topic: Topic): Promise<void> {
    await this.client.upsertEntity<TopicEntity>(
      {
        partitionKey: TOPIC_PK,
        rowKey: topic.id,
        title: topic.title,
        summary: topic.summary,
        highlights: JSON.stringify(topic.highlights),
        ...(topic.importance ? { importance: topic.importance } : {}),
        createdAt: topic.createdAt,
        updatedAt: topic.updatedAt,
      },
      'Replace',
    );
  }

  async deleteTopic(id: string): Promise<void> {
    try {
      await this.client.deleteEntity(TOPIC_PK, id);
    } catch (err) {
      if (isTableError(err, 404)) return;
      throw err;
    }
  }
}
