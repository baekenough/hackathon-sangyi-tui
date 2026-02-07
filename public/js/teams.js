// teams.js - Team management UI module for sangyi-tui
import {
  getTeams,
  createTeam,
  deleteTeam,
  getTeam,
  getTeamMembers,
  addTeamMember,
  removeTeamMember,
  getTasks,
  createTask,
  updateTask,
  deleteTask,
  getAgents,
} from './db.js';

// Local escapeHtml for this module
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Status cycle order
const STATUS_CYCLE = ['pending', 'in_progress', 'completed'];

function nextStatus(current) {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

function statusLabel(status) {
  switch (status) {
    case 'pending': return 'Pending';
    case 'in_progress': return 'In Progress';
    case 'completed': return 'Completed';
    default: return status;
  }
}

/**
 * Render the full teams panel inside the given container.
 * @param {HTMLElement} panelContent - The container to render into
 * @param {string} workspaceId - Current workspace ID
 * @param {string|null} currentTeamId - Currently selected team ID (null = list view)
 * @param {object} callbacks - { showModal, hideModal, showConfirmModal, showInputModal, escapeHtml, onTeamSelect, onRefresh }
 */
export async function renderTeamPanel(panelContent, workspaceId, currentTeamId, callbacks) {
  panelContent.innerHTML = '';

  const teamPanel = document.createElement('div');
  teamPanel.className = 'team-panel';

  if (currentTeamId) {
    // Detail view
    await renderTeamDetail(teamPanel, workspaceId, currentTeamId, callbacks);
  } else {
    // List view
    await renderTeamList(teamPanel, workspaceId, currentTeamId, callbacks);
  }

  panelContent.appendChild(teamPanel);
}

// --- Team List View ---

async function renderTeamList(teamPanel, workspaceId, currentTeamId, callbacks) {
  const header = document.createElement('div');
  header.className = 'team-header';
  header.innerHTML = '<span class="team-title">Agent Teams</span>';

  const createBtn = document.createElement('button');
  createBtn.className = 'team-create-btn';
  createBtn.textContent = '+ New Team';
  createBtn.addEventListener('click', () => {
    showCreateTeamModal(workspaceId, callbacks);
  });
  header.appendChild(createBtn);
  teamPanel.appendChild(header);

  const teams = await getTeams(workspaceId);

  if (teams.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    empty.innerHTML = 'No teams yet.<br>Create a team to coordinate multiple agents on a task.';
    teamPanel.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'team-list';

  for (const team of teams) {
    const card = document.createElement('div');
    card.className = 'team-card' + (team.id === currentTeamId ? ' active' : '');

    const top = document.createElement('div');
    top.className = 'team-card-top';

    const name = document.createElement('div');
    name.className = 'team-card-name';
    name.textContent = team.name;

    const meta = document.createElement('div');
    meta.className = 'team-card-meta';
    const memberCount = Number(team.member_count) || 0;
    const taskCount = Number(team.task_count) || 0;
    meta.textContent = `${memberCount} member${memberCount !== 1 ? 's' : ''} \u00B7 ${taskCount} task${taskCount !== 1 ? 's' : ''}`;

    top.appendChild(name);
    top.appendChild(meta);
    card.appendChild(top);

    // Status bar showing completion
    const completedCount = Number(team.completed_count) || 0;
    const statusEl = document.createElement('div');
    statusEl.className = 'team-card-status';
    if (taskCount > 0) {
      statusEl.textContent = `${completedCount}/${taskCount} completed`;
    } else {
      statusEl.textContent = team.status || 'active';
    }
    card.appendChild(statusEl);

    card.addEventListener('click', () => {
      if (callbacks.onTeamSelect) callbacks.onTeamSelect(team.id);
    });

    list.appendChild(card);
  }

  teamPanel.appendChild(list);
}

// --- Team Detail View ---

async function renderTeamDetail(teamPanel, workspaceId, teamId, callbacks) {
  const team = await getTeam(teamId);
  if (!team) {
    const empty = document.createElement('div');
    empty.className = 'panel-empty';
    empty.textContent = 'Team not found.';
    teamPanel.appendChild(empty);
    return;
  }

  // Header with back button
  const header = document.createElement('div');
  header.className = 'team-detail-header';

  const backBtn = document.createElement('button');
  backBtn.className = 'team-create-btn';
  backBtn.textContent = '\u2190 Back';
  backBtn.addEventListener('click', () => {
    if (callbacks.onTeamSelect) callbacks.onTeamSelect(null);
  });

  const title = document.createElement('div');
  title.className = 'team-detail-title';
  title.textContent = team.name;

  header.appendChild(backBtn);
  header.appendChild(title);
  teamPanel.appendChild(header);

  // Description
  if (team.description) {
    const desc = document.createElement('div');
    desc.className = 'team-detail-desc';
    desc.textContent = team.description;
    teamPanel.appendChild(desc);
  }

  // Actions
  const actions = document.createElement('div');
  actions.className = 'team-detail-actions';

  const runBtn = document.createElement('button');
  runBtn.className = 'team-run-btn';
  runBtn.textContent = '▶ Run Team';
  runBtn.addEventListener('click', async () => {
    const tasks = await getTasks(teamId);
    const members = await getTeamMembers(teamId);
    if (tasks.length === 0) {
      callbacks.showConfirmModal('No Tasks', 'Add tasks before running the team.', () => {});
      return;
    }
    if (callbacks.onRunTeam) {
      callbacks.onRunTeam(team, tasks, members);
    }
  });
  actions.appendChild(runBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'team-delete-btn';
  deleteBtn.textContent = 'Delete Team';
  deleteBtn.addEventListener('click', () => {
    callbacks.showConfirmModal(
      'Delete Team',
      `Delete "${escapeHtml(team.name)}" and all its tasks? This cannot be undone.`,
      async () => {
        await deleteTeam(teamId);
        if (callbacks.onTeamSelect) callbacks.onTeamSelect(null);
        if (callbacks.onRefresh) callbacks.onRefresh();
      }
    );
  });
  actions.appendChild(deleteBtn);
  teamPanel.appendChild(actions);

  // Members section
  const membersSection = document.createElement('div');
  membersSection.className = 'team-section';

  const membersHeader = document.createElement('div');
  membersHeader.className = 'team-section-header';

  const membersTitle = document.createElement('span');
  membersTitle.className = 'team-section-title';
  membersTitle.textContent = 'Members';

  const addMemberBtn = document.createElement('button');
  addMemberBtn.className = 'team-create-btn';
  addMemberBtn.textContent = '+ Add';
  addMemberBtn.addEventListener('click', async () => {
    await showAddMemberModal(teamId, callbacks);
  });

  membersHeader.appendChild(membersTitle);
  membersHeader.appendChild(addMemberBtn);
  membersSection.appendChild(membersHeader);

  const members = await getTeamMembers(teamId);
  const membersList = document.createElement('div');
  membersList.className = 'team-members-list';

  if (members.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'team-empty-hint';
    hint.textContent = 'No members yet. Add agents to this team.';
    membersList.appendChild(hint);
  } else {
    for (const member of members) {
      const memberEl = document.createElement('div');
      memberEl.className = 'team-member';

      const icon = document.createElement('span');
      icon.className = 'team-member-icon';
      icon.textContent = member.agent_icon || '\uD83E\uDD16';

      const nameEl = document.createElement('span');
      nameEl.className = 'team-member-name';
      nameEl.textContent = member.agent_name || member.agent_id;

      const removeBtn = document.createElement('button');
      removeBtn.className = 'task-delete-btn';
      removeBtn.textContent = '\u00D7';
      removeBtn.title = 'Remove member';
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await removeTeamMember(teamId, member.agent_id);
        if (callbacks.onRefresh) callbacks.onRefresh();
      });

      memberEl.appendChild(icon);
      memberEl.appendChild(nameEl);
      memberEl.appendChild(removeBtn);
      membersList.appendChild(memberEl);
    }
  }

  membersSection.appendChild(membersList);
  teamPanel.appendChild(membersSection);

  // Tasks section
  const tasksSection = document.createElement('div');
  tasksSection.className = 'team-section';

  const tasksHeader = document.createElement('div');
  tasksHeader.className = 'team-section-header';

  const tasksTitle = document.createElement('span');
  tasksTitle.className = 'team-section-title';
  tasksTitle.textContent = 'Tasks';

  const addTaskBtn = document.createElement('button');
  addTaskBtn.className = 'team-add-task-btn';
  addTaskBtn.textContent = '+ Add Task';
  addTaskBtn.addEventListener('click', () => {
    callbacks.showInputModal(
      'Create Task',
      [
        { name: 'subject', label: 'Subject', placeholder: 'Research latest trends' },
        { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Detailed task description...' },
      ],
      async (values) => {
        if (!values.subject) return;
        await createTask(teamId, values.subject, values.description || '');
        if (callbacks.onRefresh) callbacks.onRefresh();
      }
    );
  });

  tasksHeader.appendChild(tasksTitle);
  tasksHeader.appendChild(addTaskBtn);
  tasksSection.appendChild(tasksHeader);

  const tasks = await getTasks(teamId);
  const taskList = document.createElement('div');
  taskList.className = 'task-list';

  if (tasks.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'team-empty-hint';
    hint.textContent = 'No tasks yet. Add tasks for this team.';
    taskList.appendChild(hint);
  } else {
    for (const task of tasks) {
      const taskEl = document.createElement('div');
      taskEl.className = 'task-item';

      // Status dot - clickable to cycle status
      const dot = document.createElement('span');
      dot.className = `task-status-dot ${task.status || 'pending'}`;
      dot.title = `${statusLabel(task.status || 'pending')} - click to change`;
      dot.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newStatus = nextStatus(task.status || 'pending');
        await updateTask(task.id, { status: newStatus });
        if (callbacks.onRefresh) callbacks.onRefresh();
      });

      const info = document.createElement('div');
      info.className = 'task-item-info';

      const taskName = document.createElement('div');
      taskName.className = 'task-item-name';
      taskName.textContent = task.subject;

      info.appendChild(taskName);

      if (task.assignee_name) {
        const assignee = document.createElement('div');
        assignee.className = 'task-item-assignee';
        assignee.textContent = `${task.assignee_icon || '\uD83E\uDD16'} ${task.assignee_name}`;
        info.appendChild(assignee);
      }

      const delBtn = document.createElement('button');
      delBtn.className = 'task-delete-btn';
      delBtn.textContent = '\u00D7';
      delBtn.title = 'Delete task';
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteTask(task.id);
        if (callbacks.onRefresh) callbacks.onRefresh();
      });

      taskEl.appendChild(dot);
      taskEl.appendChild(info);
      taskEl.appendChild(delBtn);
      taskList.appendChild(taskEl);
    }
  }

  tasksSection.appendChild(taskList);
  teamPanel.appendChild(tasksSection);
}

// --- Add Member Modal (agent selection grid) ---

async function showAddMemberModal(teamId, callbacks) {
  const agents = await getAgents();
  const currentMembers = await getTeamMembers(teamId);
  const currentMemberIds = new Set(currentMembers.map(m => m.agent_id));

  const selectedIds = new Set();

  const grid = document.createElement('div');
  grid.className = 'agent-select-grid';

  for (const agent of agents) {
    // Skip agents already in the team
    if (currentMemberIds.has(agent.id)) continue;

    const item = document.createElement('div');
    item.className = 'agent-select-item';

    const emoji = document.createElement('span');
    emoji.className = 'agent-emoji';
    emoji.textContent = agent.icon || '\uD83E\uDD16';

    const name = document.createElement('span');
    name.textContent = agent.name;

    item.appendChild(emoji);
    item.appendChild(name);

    item.addEventListener('click', () => {
      if (selectedIds.has(agent.id)) {
        selectedIds.delete(agent.id);
        item.classList.remove('selected');
      } else {
        selectedIds.add(agent.id);
        item.classList.add('selected');
      }
    });

    grid.appendChild(item);
  }

  if (grid.children.length === 0) {
    const hint = document.createElement('div');
    hint.className = 'team-empty-hint';
    hint.textContent = 'All agents are already members of this team.';
    grid.appendChild(hint);
  }

  callbacks.showModal({
    title: 'Add Members',
    body: grid,
    buttons: [
      { label: 'Cancel', class: 'modal-btn-secondary' },
      {
        label: 'Add Selected',
        class: 'modal-btn-primary',
        onClick: async () => {
          for (const agentId of selectedIds) {
            await addTeamMember(teamId, agentId);
          }
          if (callbacks.onRefresh) callbacks.onRefresh();
        },
      },
    ],
  });
}

// --- Create Team Modal (with agent selection) ---

/**
 * Show modal to create a new team with agent selection.
 * @param {string} workspaceId
 * @param {object} callbacks
 */
export async function showCreateTeamModal(workspaceId, callbacks) {
  const agents = await getAgents();
  const selectedAgentIds = new Set();

  const container = document.createElement('div');

  // Name field
  const nameGroup = document.createElement('div');
  nameGroup.className = 'field-group';
  const nameLabel = document.createElement('label');
  nameLabel.textContent = 'Team Name';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Research Team';
  nameInput.dataset.field = 'name';
  nameGroup.appendChild(nameLabel);
  nameGroup.appendChild(nameInput);
  container.appendChild(nameGroup);

  // Description field
  const descGroup = document.createElement('div');
  descGroup.className = 'field-group';
  const descLabel = document.createElement('label');
  descLabel.textContent = 'Description';
  const descInput = document.createElement('textarea');
  descInput.rows = 2;
  descInput.placeholder = 'What should this team accomplish?';
  descInput.dataset.field = 'description';
  descGroup.appendChild(descLabel);
  descGroup.appendChild(descInput);
  container.appendChild(descGroup);

  // Agent selection grid
  const agentGroup = document.createElement('div');
  agentGroup.className = 'field-group';
  const agentLabel = document.createElement('label');
  agentLabel.textContent = 'Select Agents';
  agentGroup.appendChild(agentLabel);

  const grid = document.createElement('div');
  grid.className = 'agent-select-grid';

  for (const agent of agents) {
    const item = document.createElement('div');
    item.className = 'agent-select-item';

    const emoji = document.createElement('span');
    emoji.className = 'agent-emoji';
    emoji.textContent = agent.icon || '\uD83E\uDD16';

    const name = document.createElement('span');
    name.textContent = agent.name;

    item.appendChild(emoji);
    item.appendChild(name);

    item.addEventListener('click', () => {
      if (selectedAgentIds.has(agent.id)) {
        selectedAgentIds.delete(agent.id);
        item.classList.remove('selected');
      } else {
        selectedAgentIds.add(agent.id);
        item.classList.add('selected');
      }
    });

    grid.appendChild(item);
  }

  agentGroup.appendChild(grid);
  container.appendChild(agentGroup);

  callbacks.showModal({
    title: 'Create Agent Team',
    body: container,
    buttons: [
      { label: 'Cancel', class: 'modal-btn-secondary' },
      {
        label: 'Create',
        class: 'modal-btn-primary',
        onClick: async () => {
          const teamName = nameInput.value.trim();
          if (!teamName) return;
          const description = descInput.value.trim();
          const teamId = await createTeam(workspaceId, teamName, description);

          // Add selected agents as members
          for (const agentId of selectedAgentIds) {
            await addTeamMember(teamId, agentId);
          }

          if (callbacks.onTeamSelect) callbacks.onTeamSelect(teamId);
          if (callbacks.onRefresh) callbacks.onRefresh();
        },
      },
    ],
  });
}
