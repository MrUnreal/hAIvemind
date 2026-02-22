<template>
  <div v-if="visible" class="auth-panel">
    <h3>🔐 Authentication</h3>

    <!-- Auth Status -->
    <div class="auth-status">
      <span class="auth-status-label">Auth:</span>
      <span :class="['auth-status-badge', authEnabled ? 'enabled' : 'disabled']">
        {{ authEnabled ? 'Enabled' : 'Disabled' }}
      </span>
      <button v-if="isAdmin || !authEnabled" class="auth-toggle-btn" @click="toggleAuth">
        {{ authEnabled ? 'Disable' : 'Enable' }}
      </button>
    </div>

    <!-- Not logged in -->
    <div v-if="authEnabled && !currentUser" class="auth-login-section">
      <div class="auth-tabs">
        <button
          :class="['auth-tab', { active: authMode === 'login' }]"
          @click="authMode = 'login'"
        >Login</button>
        <button
          :class="['auth-tab', { active: authMode === 'register' }]"
          @click="authMode = 'register'"
        >Register</button>
      </div>

      <form class="auth-form" @submit.prevent="authMode === 'login' ? login() : register()">
        <input
          v-model="username"
          class="auth-input"
          placeholder="Username"
          autocomplete="username"
        />
        <div class="auth-password-wrap">
          <input
            v-model="password"
            :type="showPw ? 'text' : 'password'"
            class="auth-input"
            placeholder="Password"
            autocomplete="current-password"
          />
          <button type="button" class="auth-pw-toggle" @click="showPw = !showPw">
            {{ showPw ? '🙈' : '👁️' }}
          </button>
        </div>
        <select v-if="authMode === 'register'" v-model="role" class="auth-select">
          <option value="user">User</option>
          <option value="admin">Admin</option>
          <option value="viewer">Viewer</option>
        </select>
        <button type="submit" class="auth-submit-btn" :disabled="!username || !password">
          {{ authMode === 'login' ? 'Login' : 'Register' }}
        </button>
        <p v-if="authError" class="auth-error">{{ authError }}</p>
      </form>
    </div>

    <!-- Logged in -->
    <div v-if="currentUser" class="auth-user-section">
      <div class="auth-user-card">
        <span class="auth-user-avatar">👤</span>
        <div class="auth-user-info">
          <strong class="auth-username">{{ currentUser.username }}</strong>
          <span :class="['auth-role-badge', `role-${currentUser.role}`]">
            {{ currentUser.role }}
          </span>
        </div>
        <button class="auth-logout-btn" @click="logout">Logout</button>
      </div>
    </div>

    <!-- User list (admin only) -->
    <div v-if="isAdmin && users.length" class="auth-users-section">
      <h4>Users ({{ users.length }})</h4>
      <div v-for="u in users" :key="u.id" class="auth-user-row">
        <span class="auth-row-name">{{ u.username }}</span>
        <span :class="['auth-role-badge', `role-${u.role}`]">{{ u.role }}</span>
        <select
          v-if="u.id !== currentUser?.userId"
          :value="u.role"
          class="auth-role-select"
          @change="changeRole(u.id, $event.target.value)"
        >
          <option value="admin">admin</option>
          <option value="user">user</option>
          <option value="viewer">viewer</option>
        </select>
        <button
          v-if="u.id !== currentUser?.userId"
          class="auth-delete-btn"
          @click="deleteUser(u.id)"
        >🗑️</button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';

const props = defineProps({
  visible: Boolean,
});

const emit = defineEmits(['close', 'authChange']);

const authEnabled = ref(false);
const currentUser = ref(null);
const token = ref(localStorage.getItem('haivemind-token') || '');
const users = ref([]);

const authMode = ref('login');
const username = ref('');
const password = ref('');
const role = ref('user');
const showPw = ref(false);
const authError = ref('');

const isAdmin = computed(() => currentUser.value?.role === 'admin');

const headers = computed(() => {
  const h = { 'Content-Type': 'application/json' };
  if (token.value) h.Authorization = `Bearer ${token.value}`;
  return h;
});

async function fetchStatus() {
  try {
    const res = await fetch('/api/auth/status');
    const data = await res.json();
    authEnabled.value = data.enabled;
  } catch { /* ignore */ }
}

async function fetchMe() {
  if (!token.value) { currentUser.value = null; return; }
  try {
    const res = await fetch('/api/auth/me', { headers: headers.value });
    if (res.ok) {
      currentUser.value = await res.json();
      fetchUsers();
    } else {
      currentUser.value = null;
      token.value = '';
      localStorage.removeItem('haivemind-token');
    }
  } catch {
    currentUser.value = null;
  }
}

async function fetchUsers() {
  if (!isAdmin.value) return;
  try {
    const res = await fetch('/api/auth/users', { headers: headers.value });
    if (res.ok) users.value = await res.json();
  } catch { /* ignore */ }
}

async function login() {
  authError.value = '';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: username.value, password: password.value }),
    });
    const data = await res.json();
    if (!res.ok) { authError.value = data.error; return; }
    token.value = data.token;
    localStorage.setItem('haivemind-token', data.token);
    currentUser.value = data.user;
    username.value = '';
    password.value = '';
    emit('authChange', data.user);
    fetchUsers();
  } catch (e) { authError.value = e.message; }
}

async function register() {
  authError.value = '';
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: username.value,
        password: password.value,
        role: role.value,
      }),
    });
    const data = await res.json();
    if (!res.ok) { authError.value = data.error; return; }
    // Auto-login after register
    await login();
  } catch (e) { authError.value = e.message; }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', headers: headers.value });
  } catch { /* ignore */ }
  token.value = '';
  currentUser.value = null;
  users.value = [];
  localStorage.removeItem('haivemind-token');
  emit('authChange', null);
}

async function toggleAuth() {
  const endpoint = authEnabled.value ? '/api/auth/disable' : '/api/auth/enable';
  try {
    const res = await fetch(endpoint, { method: 'POST', headers: headers.value });
    const data = await res.json();
    authEnabled.value = data.enabled;
  } catch { /* ignore */ }
}

async function changeRole(userId, newRole) {
  try {
    await fetch(`/api/auth/users/${userId}/role`, {
      method: 'PATCH',
      headers: headers.value,
      body: JSON.stringify({ role: newRole }),
    });
    fetchUsers();
  } catch { /* ignore */ }
}

async function deleteUser(userId) {
  try {
    await fetch(`/api/auth/users/${userId}`, {
      method: 'DELETE',
      headers: headers.value,
    });
    fetchUsers();
  } catch { /* ignore */ }
}

watch(() => props.visible, (v) => {
  if (v) { fetchStatus(); fetchMe(); }
});

onMounted(() => {
  fetchStatus();
  if (token.value) fetchMe();
});
</script>

<style scoped>
.auth-panel {
  padding: 1rem;
}
.auth-panel h3 {
  margin: 0 0 1rem;
  color: var(--text-primary);
}
.auth-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
  padding: 0.5rem;
  background: var(--bg-secondary);
  border-radius: 6px;
}
.auth-status-label {
  color: var(--text-secondary);
  font-size: 0.85rem;
}
.auth-status-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
}
.auth-status-badge.enabled {
  background: #22c55e33;
  color: #22c55e;
}
.auth-status-badge.disabled {
  background: #64748b33;
  color: #94a3b8;
}
.auth-toggle-btn {
  margin-left: auto;
  padding: 4px 10px;
  font-size: 0.75rem;
  background: var(--bg-tertiary, #374151);
  color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563);
  border-radius: 4px;
  cursor: pointer;
}
.auth-tabs {
  display: flex;
  gap: 0;
  margin-bottom: 0.75rem;
}
.auth-tab {
  flex: 1;
  padding: 6px 0;
  font-size: 0.85rem;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  border: 1px solid var(--border-color, #4b5563);
  cursor: pointer;
}
.auth-tab:first-child { border-radius: 4px 0 0 4px; }
.auth-tab:last-child { border-radius: 0 4px 4px 0; }
.auth-tab.active {
  background: var(--accent-color, #3b82f6);
  color: #fff;
  border-color: var(--accent-color, #3b82f6);
}
.auth-form {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.auth-input {
  padding: 8px 10px;
  font-size: 0.85rem;
  background: var(--input-bg, #1f2937);
  color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563);
  border-radius: 4px;
  outline: none;
  width: 100%;
  box-sizing: border-box;
}
.auth-password-wrap {
  position: relative;
}
.auth-password-wrap .auth-input { padding-right: 36px; }
.auth-pw-toggle {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.85rem;
}
.auth-select {
  padding: 6px 8px;
  font-size: 0.85rem;
  background: var(--input-bg, #1f2937);
  color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563);
  border-radius: 4px;
}
.auth-submit-btn {
  padding: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  background: var(--accent-color, #3b82f6);
  color: #fff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}
.auth-submit-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.auth-error {
  color: #ef4444;
  font-size: 0.8rem;
  margin: 0;
}
.auth-user-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: var(--bg-secondary);
  border-radius: 6px;
  margin-bottom: 1rem;
}
.auth-user-avatar { font-size: 1.5rem; }
.auth-user-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}
.auth-username {
  color: var(--text-primary);
  font-size: 0.9rem;
}
.auth-role-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
  width: fit-content;
}
.role-admin { background: #f59e0b33; color: #f59e0b; }
.role-user { background: #3b82f633; color: #60a5fa; }
.role-viewer { background: #64748b33; color: #94a3b8; }
.auth-logout-btn {
  padding: 4px 10px;
  font-size: 0.75rem;
  background: #ef444433;
  color: #ef4444;
  border: 1px solid #ef444455;
  border-radius: 4px;
  cursor: pointer;
}
.auth-users-section h4 {
  margin: 0 0 0.5rem;
  color: var(--text-primary);
  font-size: 0.85rem;
}
.auth-user-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.5rem;
  border-bottom: 1px solid var(--border-color, #374151);
}
.auth-row-name {
  flex: 1;
  color: var(--text-primary);
  font-size: 0.85rem;
}
.auth-role-select {
  padding: 2px 4px;
  font-size: 0.7rem;
  background: var(--bg-tertiary, #374151);
  color: var(--text-primary);
  border: 1px solid var(--border-color, #4b5563);
  border-radius: 3px;
}
.auth-delete-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.8rem;
  padding: 2px;
}
</style>
