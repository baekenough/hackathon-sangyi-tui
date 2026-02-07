// db.js - DuckDB WASM local database layer
import * as duckdb from 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

let db = null;
let conn = null;

export async function initDB() {
  const BUNDLES = duckdb.getJsDelivrBundles();
  const bundle = await duckdb.selectBundle(BUNDLES);
  const worker_url = URL.createObjectURL(
    new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' })
  );
  const worker = new Worker(worker_url);
  const logger = new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING);
  db = new duckdb.AsyncDuckDB(logger, worker);
  await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
  URL.revokeObjectURL(worker_url);

  conn = await db.connect();

  await createSchema();

  const restored = await restoreFromIndexedDB();

  if (!restored) {
    await loadDefaults();
    await createWorkspace('Default', 'You are Claude, a helpful AI assistant.', 'claude-sonnet-4-5-20250929');
  }

  return db;
}

async function createSchema() {
  await conn.query(`
    CREATE SEQUENCE IF NOT EXISTS msg_seq START 1;
    CREATE SEQUENCE IF NOT EXISTS mem_seq START 1;
    CREATE SEQUENCE IF NOT EXISTS task_seq START 1;

    CREATE TABLE IF NOT EXISTS workspaces (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      system_prompt TEXT DEFAULT '',
      model VARCHAR DEFAULT 'claude-sonnet-4-5-20250929',
      session_id VARCHAR,
      created_at BIGINT DEFAULT epoch_ms(now())
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER DEFAULT nextval('msg_seq'),
      workspace_id VARCHAR NOT NULL,
      role VARCHAR NOT NULL,
      content TEXT NOT NULL,
      tool_name VARCHAR,
      cost_usd DOUBLE DEFAULT 0,
      created_at BIGINT DEFAULT epoch_ms(now())
    );

    CREATE TABLE IF NOT EXISTS agents (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      description TEXT,
      system_prompt TEXT,
      icon VARCHAR DEFAULT '🤖',
      model VARCHAR DEFAULT 'claude-sonnet-4-5-20250929',
      category VARCHAR DEFAULT 'general'
    );

    CREATE TABLE IF NOT EXISTS skills (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      description TEXT,
      prompt_template TEXT,
      icon VARCHAR DEFAULT '⚡',
      category VARCHAR DEFAULT 'general'
    );

    CREATE TABLE IF NOT EXISTS guides (
      id VARCHAR PRIMARY KEY,
      name VARCHAR NOT NULL,
      description TEXT,
      content TEXT,
      icon VARCHAR DEFAULT '📖',
      category VARCHAR DEFAULT 'general'
    );

    CREATE TABLE IF NOT EXISTS workspace_config (
      workspace_id VARCHAR NOT NULL,
      item_type VARCHAR NOT NULL,
      item_id VARCHAR NOT NULL,
      PRIMARY KEY (workspace_id, item_type, item_id)
    );

    CREATE TABLE IF NOT EXISTS memory (
      id INTEGER DEFAULT nextval('mem_seq'),
      workspace_id VARCHAR NOT NULL,
      key VARCHAR NOT NULL,
      value TEXT NOT NULL,
      created_at BIGINT DEFAULT epoch_ms(now())
    );

    CREATE TABLE IF NOT EXISTS teams (
      id VARCHAR PRIMARY KEY,
      workspace_id VARCHAR NOT NULL,
      name VARCHAR NOT NULL,
      description TEXT DEFAULT '',
      status VARCHAR DEFAULT 'active',
      created_at BIGINT DEFAULT epoch_ms(now())
    );

    CREATE TABLE IF NOT EXISTS team_members (
      team_id VARCHAR NOT NULL,
      agent_id VARCHAR NOT NULL,
      role VARCHAR DEFAULT 'member',
      PRIMARY KEY (team_id, agent_id)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER DEFAULT nextval('task_seq'),
      team_id VARCHAR NOT NULL,
      subject VARCHAR NOT NULL,
      description TEXT DEFAULT '',
      status VARCHAR DEFAULT 'pending',
      assignee_agent_id VARCHAR,
      created_at BIGINT DEFAULT epoch_ms(now())
    );
  `);
}

export function getConn() {
  return conn;
}

// === Workspaces ===

export async function createWorkspace(name, systemPrompt = '', model = 'claude-sonnet-4-5-20250929') {
  const id = crypto.randomUUID();
  await conn.query(`
    INSERT INTO workspaces (id, name, system_prompt, model, session_id, created_at)
    VALUES ('${esc(id)}', '${esc(name)}', '${esc(systemPrompt)}', '${esc(model)}', NULL, epoch_ms(now()))
  `);
  schedulePersist();
  return id;
}

export async function getWorkspaces() {
  const result = await conn.query(`
    SELECT w.*, COALESCE(m.cnt, 0) as message_count
    FROM workspaces w
    LEFT JOIN (SELECT workspace_id, COUNT(*) as cnt FROM messages GROUP BY workspace_id) m
    ON w.id = m.workspace_id
    ORDER BY w.created_at DESC
  `);
  return arrowToObjects(result);
}

export async function getWorkspace(id) {
  const result = await conn.query(`SELECT * FROM workspaces WHERE id = '${esc(id)}'`);
  const rows = arrowToObjects(result);
  return rows.length > 0 ? rows[0] : null;
}

export async function updateWorkspace(id, updates) {
  const setClauses = [];
  if (updates.name !== undefined) setClauses.push(`name = '${esc(updates.name)}'`);
  if (updates.system_prompt !== undefined) setClauses.push(`system_prompt = '${esc(updates.system_prompt)}'`);
  if (updates.model !== undefined) setClauses.push(`model = '${esc(updates.model)}'`);
  if (updates.session_id !== undefined) setClauses.push(`session_id = '${esc(updates.session_id)}'`);
  if (setClauses.length === 0) return;
  await conn.query(`UPDATE workspaces SET ${setClauses.join(', ')} WHERE id = '${esc(id)}'`);
  schedulePersist();
}

export async function deleteWorkspace(id) {
  // Delete teams and their related data first
  const teams = await conn.query(`SELECT id FROM teams WHERE workspace_id = '${esc(id)}'`);
  const teamRows = arrowToObjects(teams);
  for (const team of teamRows) {
    await conn.query(`DELETE FROM tasks WHERE team_id = '${esc(team.id)}'`);
    await conn.query(`DELETE FROM team_members WHERE team_id = '${esc(team.id)}'`);
  }
  await conn.query(`DELETE FROM teams WHERE workspace_id = '${esc(id)}'`);

  // Delete workspace-related data
  await conn.query(`DELETE FROM messages WHERE workspace_id = '${esc(id)}'`);
  await conn.query(`DELETE FROM workspace_config WHERE workspace_id = '${esc(id)}'`);
  await conn.query(`DELETE FROM memory WHERE workspace_id = '${esc(id)}'`);
  await conn.query(`DELETE FROM workspaces WHERE id = '${esc(id)}'`);
  schedulePersist();
}

// === Messages ===

export async function addMessage(workspaceId, role, content, toolName = null, costUsd = 0) {
  const toolVal = toolName ? `'${esc(toolName)}'` : 'NULL';
  await conn.query(`
    INSERT INTO messages (workspace_id, role, content, tool_name, cost_usd, created_at)
    VALUES ('${esc(workspaceId)}', '${esc(role)}', '${esc(content)}', ${toolVal}, ${Number(costUsd) || 0}, epoch_ms(now()))
  `);
  schedulePersist();
}

export async function getMessages(workspaceId, limit = 200) {
  const result = await conn.query(`
    SELECT * FROM messages
    WHERE workspace_id = '${esc(workspaceId)}'
    ORDER BY created_at ASC
    LIMIT ${Number(limit)}
  `);
  return arrowToObjects(result);
}

export async function clearMessages(workspaceId) {
  await conn.query(`DELETE FROM messages WHERE workspace_id = '${esc(workspaceId)}'`);
  schedulePersist();
}

export async function getSessionId(workspaceId) {
  const ws = await getWorkspace(workspaceId);
  if (!ws) return null;
  if (ws.session_id) return ws.session_id;
  const sessionId = crypto.randomUUID();
  await updateWorkspace(workspaceId, { session_id: sessionId });
  return sessionId;
}

// === Catalog: Agents ===

export async function getAgents() {
  const result = await conn.query('SELECT * FROM agents ORDER BY category, name');
  return arrowToObjects(result);
}

export async function createAgent(agent) {
  const id = agent.id || crypto.randomUUID();
  await conn.query(`
    INSERT INTO agents (id, name, description, system_prompt, icon, model, category)
    VALUES (
      '${esc(id)}',
      '${esc(agent.name)}',
      '${esc(agent.description || '')}',
      '${esc(agent.system_prompt || '')}',
      '${esc(agent.icon || '🤖')}',
      '${esc(agent.model || 'claude-sonnet-4-5-20250929')}',
      '${esc(agent.category || 'general')}'
    )
  `);
  schedulePersist();
  return id;
}

// === Catalog: Skills ===

export async function getSkills() {
  const result = await conn.query('SELECT * FROM skills ORDER BY category, name');
  return arrowToObjects(result);
}

export async function createSkill(skill) {
  const id = skill.id || crypto.randomUUID();
  await conn.query(`
    INSERT INTO skills (id, name, description, prompt_template, icon, category)
    VALUES (
      '${esc(id)}',
      '${esc(skill.name)}',
      '${esc(skill.description || '')}',
      '${esc(skill.prompt_template || '')}',
      '${esc(skill.icon || '⚡')}',
      '${esc(skill.category || 'general')}'
    )
  `);
  schedulePersist();
  return id;
}

// === Catalog: Guides ===

export async function getGuides() {
  const result = await conn.query('SELECT * FROM guides ORDER BY category, name');
  return arrowToObjects(result);
}

export async function createGuide(guide) {
  const id = guide.id || crypto.randomUUID();
  await conn.query(`
    INSERT INTO guides (id, name, description, content, icon, category)
    VALUES (
      '${esc(id)}',
      '${esc(guide.name)}',
      '${esc(guide.description || '')}',
      '${esc(guide.content || '')}',
      '${esc(guide.icon || '📖')}',
      '${esc(guide.category || 'general')}'
    )
  `);
  schedulePersist();
  return id;
}

// === Workspace Config ===

export async function getWorkspaceConfig(workspaceId) {
  const result = await conn.query(`
    SELECT item_type, item_id FROM workspace_config
    WHERE workspace_id = '${esc(workspaceId)}'
  `);
  const rows = arrowToObjects(result);
  const config = { agents: [], skills: [], guides: [] };
  for (const row of rows) {
    if (config[row.item_type + 's']) {
      config[row.item_type + 's'].push(row.item_id);
    }
  }
  return config;
}

export async function toggleWorkspaceConfig(workspaceId, type, itemId) {
  const existing = await conn.query(`
    SELECT 1 FROM workspace_config
    WHERE workspace_id = '${esc(workspaceId)}'
      AND item_type = '${esc(type)}'
      AND item_id = '${esc(itemId)}'
  `);
  const rows = arrowToObjects(existing);
  if (rows.length > 0) {
    await conn.query(`
      DELETE FROM workspace_config
      WHERE workspace_id = '${esc(workspaceId)}'
        AND item_type = '${esc(type)}'
        AND item_id = '${esc(itemId)}'
    `);
  } else {
    await conn.query(`
      INSERT INTO workspace_config (workspace_id, item_type, item_id)
      VALUES ('${esc(workspaceId)}', '${esc(type)}', '${esc(itemId)}')
    `);
  }
  schedulePersist();
}

// === Memory ===

export async function saveMemory(workspaceId, key, value) {
  const existing = await conn.query(`
    SELECT id FROM memory
    WHERE workspace_id = '${esc(workspaceId)}' AND key = '${esc(key)}'
  `);
  const rows = arrowToObjects(existing);
  if (rows.length > 0) {
    await conn.query(`
      UPDATE memory SET value = '${esc(value)}', created_at = epoch_ms(now())
      WHERE workspace_id = '${esc(workspaceId)}' AND key = '${esc(key)}'
    `);
  } else {
    await conn.query(`
      INSERT INTO memory (workspace_id, key, value, created_at)
      VALUES ('${esc(workspaceId)}', '${esc(key)}', '${esc(value)}', epoch_ms(now()))
    `);
  }
  schedulePersist();
}

export async function getMemory(workspaceId) {
  const result = await conn.query(`
    SELECT key, value, created_at FROM memory
    WHERE workspace_id = '${esc(workspaceId)}'
    ORDER BY created_at ASC
  `);
  return arrowToObjects(result);
}

// === Teams ===

export async function createTeam(workspaceId, name, description = '') {
  const id = crypto.randomUUID();
  await conn.query(`
    INSERT INTO teams (id, workspace_id, name, description, status, created_at)
    VALUES ('${esc(id)}', '${esc(workspaceId)}', '${esc(name)}', '${esc(description)}', 'active', epoch_ms(now()))
  `);
  schedulePersist();
  return id;
}

export async function getTeams(workspaceId) {
  const result = await conn.query(`
    SELECT t.*,
      (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = t.id) as member_count,
      (SELECT COUNT(*) FROM tasks tk WHERE tk.team_id = t.id) as task_count,
      (SELECT COUNT(*) FROM tasks tk WHERE tk.team_id = t.id AND tk.status = 'completed') as completed_count
    FROM teams t
    WHERE t.workspace_id = '${esc(workspaceId)}'
    ORDER BY t.created_at DESC
  `);
  return arrowToObjects(result);
}

export async function getTeam(id) {
  const result = await conn.query(`SELECT * FROM teams WHERE id = '${esc(id)}'`);
  const rows = arrowToObjects(result);
  return rows.length > 0 ? rows[0] : null;
}

export async function updateTeam(id, updates) {
  const setClauses = [];
  if (updates.name !== undefined) setClauses.push(`name = '${esc(updates.name)}'`);
  if (updates.description !== undefined) setClauses.push(`description = '${esc(updates.description)}'`);
  if (updates.status !== undefined) setClauses.push(`status = '${esc(updates.status)}'`);
  if (setClauses.length === 0) return;
  await conn.query(`UPDATE teams SET ${setClauses.join(', ')} WHERE id = '${esc(id)}'`);
  schedulePersist();
}

export async function deleteTeam(id) {
  await conn.query(`DELETE FROM tasks WHERE team_id = '${esc(id)}'`);
  await conn.query(`DELETE FROM team_members WHERE team_id = '${esc(id)}'`);
  await conn.query(`DELETE FROM teams WHERE id = '${esc(id)}'`);
  schedulePersist();
}

// === Team Members ===

export async function addTeamMember(teamId, agentId, role = 'member') {
  await conn.query(`
    INSERT INTO team_members (team_id, agent_id, role)
    VALUES ('${esc(teamId)}', '${esc(agentId)}', '${esc(role)}')
  `);
  schedulePersist();
}

export async function removeTeamMember(teamId, agentId) {
  await conn.query(`
    DELETE FROM team_members WHERE team_id = '${esc(teamId)}' AND agent_id = '${esc(agentId)}'
  `);
  schedulePersist();
}

export async function getTeamMembers(teamId) {
  const result = await conn.query(`
    SELECT tm.*, a.name as agent_name, a.icon as agent_icon, a.description as agent_description, a.model as agent_model
    FROM team_members tm
    JOIN agents a ON a.id = tm.agent_id
    WHERE tm.team_id = '${esc(teamId)}'
    ORDER BY a.name
  `);
  return arrowToObjects(result);
}

// === Tasks ===

export async function createTask(teamId, subject, description = '', assigneeAgentId = null) {
  const id = crypto.randomUUID();
  const assignee = assigneeAgentId ? `'${esc(assigneeAgentId)}'` : 'NULL';
  await conn.query(`
    INSERT INTO tasks (id, team_id, subject, description, status, assignee_agent_id, created_at)
    VALUES ('${esc(id)}', '${esc(teamId)}', '${esc(subject)}', '${esc(description)}', 'pending', ${assignee}, epoch_ms(now()))
  `);
  schedulePersist();
  return id;
}

export async function getTasks(teamId) {
  const result = await conn.query(`
    SELECT tk.*, a.name as assignee_name, a.icon as assignee_icon
    FROM tasks tk
    LEFT JOIN agents a ON a.id = tk.assignee_agent_id
    WHERE tk.team_id = '${esc(teamId)}'
    ORDER BY tk.created_at ASC
  `);
  return arrowToObjects(result);
}

export async function updateTask(id, updates) {
  const setClauses = [];
  if (updates.subject !== undefined) setClauses.push(`subject = '${esc(updates.subject)}'`);
  if (updates.description !== undefined) setClauses.push(`description = '${esc(updates.description)}'`);
  if (updates.status !== undefined) setClauses.push(`status = '${esc(updates.status)}'`);
  if (updates.assignee_agent_id !== undefined) {
    setClauses.push(updates.assignee_agent_id ? `assignee_agent_id = '${esc(updates.assignee_agent_id)}'` : `assignee_agent_id = NULL`);
  }
  if (setClauses.length === 0) return;
  await conn.query(`UPDATE tasks SET ${setClauses.join(', ')} WHERE id = '${esc(id)}'`);
  schedulePersist();
}

export async function deleteTask(id) {
  await conn.query(`DELETE FROM tasks WHERE id = '${esc(id)}'`);
  schedulePersist();
}

// === Persistence (IndexedDB) ===

let persistTimer = null;

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => persistToIndexedDB(), 500);
}

async function persistToIndexedDB() {
  const tables = ['workspaces', 'messages', 'agents', 'skills', 'guides', 'workspace_config', 'memory', 'teams', 'team_members', 'tasks'];
  const backup = {};
  for (const table of tables) {
    const result = await conn.query(`SELECT * FROM ${table}`);
    backup[table] = arrowToObjects(result);
  }

  return new Promise((resolve, reject) => {
    const dbReq = indexedDB.open('sangyi-tui-db', 1);
    dbReq.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains('backup')) {
        idb.createObjectStore('backup');
      }
    };
    dbReq.onsuccess = (e) => {
      const idb = e.target.result;
      const tx = idb.transaction('backup', 'readwrite');
      tx.objectStore('backup').put(backup, 'data');
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
    dbReq.onerror = () => reject(dbReq.error);
  });
}

async function restoreFromIndexedDB() {
  return new Promise((resolve) => {
    const dbReq = indexedDB.open('sangyi-tui-db', 1);
    dbReq.onupgradeneeded = (e) => {
      const idb = e.target.result;
      if (!idb.objectStoreNames.contains('backup')) {
        idb.createObjectStore('backup');
      }
    };
    dbReq.onsuccess = (e) => {
      const idb = e.target.result;
      const tx = idb.transaction('backup', 'readonly');
      const getReq = tx.objectStore('backup').get('data');
      getReq.onsuccess = async () => {
        const backup = getReq.result;
        if (!backup) {
          resolve(false);
          return;
        }
        try {
          for (const [table, rows] of Object.entries(backup)) {
            if (!rows || rows.length === 0) continue;
            for (const row of rows) {
              const columns = Object.keys(row);
              const values = columns.map((col) => {
                const val = row[col];
                if (val === null || val === undefined) return 'NULL';
                if (typeof val === 'number') return String(val);
                return `'${esc(String(val))}'`;
              });
              await conn.query(
                `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')})`
              );
            }
          }
          resolve(true);
        } catch (err) {
          console.error('Failed to restore from IndexedDB:', err);
          resolve(false);
        }
      };
      getReq.onerror = () => resolve(false);
    };
    dbReq.onerror = () => resolve(false);
  });
}

async function loadDefaults() {
  const [agents, skills, guides] = await Promise.all([
    fetch('data/agents.json').then((r) => r.json()),
    fetch('data/skills.json').then((r) => r.json()),
    fetch('data/guides.json').then((r) => r.json()),
  ]);

  for (const a of agents) {
    await conn.query(`
      INSERT INTO agents (id, name, description, system_prompt, icon, model, category)
      VALUES (
        '${esc(a.id)}',
        '${esc(a.name)}',
        '${esc(a.description || '')}',
        '${esc(a.system_prompt || '')}',
        '${esc(a.icon || '🤖')}',
        '${esc(a.model || 'claude-sonnet-4-5-20250929')}',
        '${esc(a.category || 'general')}'
      )
    `);
  }

  for (const s of skills) {
    await conn.query(`
      INSERT INTO skills (id, name, description, prompt_template, icon, category)
      VALUES (
        '${esc(s.id)}',
        '${esc(s.name)}',
        '${esc(s.description || '')}',
        '${esc(s.prompt_template || '')}',
        '${esc(s.icon || '⚡')}',
        '${esc(s.category || 'general')}'
      )
    `);
  }

  for (const g of guides) {
    await conn.query(`
      INSERT INTO guides (id, name, description, content, icon, category)
      VALUES (
        '${esc(g.id)}',
        '${esc(g.name)}',
        '${esc(g.description || '')}',
        '${esc(g.content || '')}',
        '${esc(g.icon || '📖')}',
        '${esc(g.category || 'general')}'
      )
    `);
  }
}

// Helper: Arrow table to plain objects
function arrowToObjects(arrowResult) {
  const rows = arrowResult.toArray();
  const fields = arrowResult.schema.fields;
  return rows.map((row) => {
    const obj = {};
    for (const field of fields) {
      const val = row[field.name];
      // Convert BigInt to Number for JSON compatibility
      obj[field.name] = typeof val === 'bigint' ? Number(val) : val;
    }
    return obj;
  });
}

// Helper: Escape single quotes for SQL
function esc(str) {
  if (str == null) return '';
  return String(str).replace(/'/g, "''");
}

// --- Raw SQL execution for SQL console ---
export async function runSQL(sql) {
  const conn = await db.connect();
  try {
    const result = await conn.query(sql);
    const rows = result.toArray().map(row => {
      const obj = {};
      for (const key of Object.keys(row)) {
        const val = row[key];
        obj[key] = typeof val === 'bigint' ? Number(val) : val;
      }
      return obj;
    });
    return rows;
  } finally {
    await conn.close();
  }
}
