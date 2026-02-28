const { createApp, ref, computed, onMounted, onUnmounted } = Vue;

// ── API helpers ───────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`/api${path}`, opts);
  return res.json();
}
const get  = (path)       => api('GET',    path);
const post = (path, body) => api('POST',   path, body);
const del  = (path)       => api('DELETE', path);

// ── Formatters ────────────────────────────────────────────────────────────────
function timeAgo(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 5000)   return 'just now';
  if (diff < 60000)  return `${Math.floor(diff/1000)}s ago`;
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  return `${Math.floor(diff/3600000)}h ago`;
}
function shortId(id) { return id ? id.slice(0, 8) + '…' : '—'; }
function copyToClipboard(text) { navigator.clipboard?.writeText(text).catch(() => {}); }

// ── Root App ──────────────────────────────────────────────────────────────────
const App = {
  template: `
<div class="min-h-screen bg-base-300">
  <!-- Navbar -->
  <div class="navbar bg-base-100 shadow-lg px-6">
    <div class="flex-1 gap-3">
      <span class="text-xl font-bold tracking-tight">⬡ ContextFS</span>
      <div class="badge badge-outline badge-sm">Dashboard</div>
    </div>
    <div class="flex-none gap-3 items-center">
      <transition name="fade">
        <span v-if="toast" class="badge badge-success gap-1 text-xs">{{ toast }}</span>
      </transition>
      <div class="badge" :class="statusBadge">{{ status.wsClientsOnline || 0 }} online</div>
      <button class="btn btn-sm btn-ghost" @click="refresh" :class="{ 'loading': loading }">
        <span v-if="!loading">↺ Refresh</span>
      </button>
    </div>
  </div>

  <!-- Stats bar -->
  <div class="px-6 py-4 grid grid-cols-2 md:grid-cols-4 gap-3">
    <div class="stat bg-base-100 rounded-xl py-3 px-4">
      <div class="stat-title text-xs opacity-60">WS Clients</div>
      <div class="stat-value text-2xl">{{ status.wsClients || 0 }}</div>
      <div class="stat-desc">{{ status.wsClientsOnline || 0 }} online</div>
    </div>
    <div class="stat bg-base-100 rounded-xl py-3 px-4">
      <div class="stat-title text-xs opacity-60">Virtual Clients</div>
      <div class="stat-value text-2xl">{{ status.virtualClients || 0 }}</div>
    </div>
    <div class="stat bg-base-100 rounded-xl py-3 px-4">
      <div class="stat-title text-xs opacity-60">Workspaces</div>
      <div class="stat-value text-2xl">{{ status.workspaces || 0 }}</div>
    </div>
    <div class="stat bg-base-100 rounded-xl py-3 px-4">
      <div class="stat-title text-xs opacity-60">MCP Sessions</div>
      <div class="stat-value text-2xl">{{ mcpSessions.length }}</div>
    </div>
  </div>

  <!-- Main content -->
  <div class="px-6 pb-6 grid grid-cols-1 xl:grid-cols-2 gap-4">

    <!-- WS Clients -->
    <div class="card bg-base-100 shadow">
      <div class="card-body p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="card-title text-base">WS Clients</h2>
          <button class="btn btn-xs btn-primary" @click="openModal('createWsc')">+ New</button>
        </div>
        <div v-if="wsClients.length === 0" class="text-center opacity-40 py-6 text-sm">No WS clients yet</div>
        <div v-else class="overflow-x-auto">
          <table class="table table-xs">
            <thead>
              <tr><th>ID</th><th>Name</th><th>Status</th><th>Heartbeat</th><th>CPU</th><th>RAM</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="c in wsClients" :key="c.id" class="hover">
                <td>
                  <button class="font-mono text-xs link link-hover" @click="copyToClipboard(c.id)" title="Click to copy">
                    {{ shortId(c.id) }}
                  </button>
                </td>
                <td class="text-xs">{{ c.name }}</td>
                <td>
                  <div class="flex items-center gap-1">
                    <span class="w-2 h-2 rounded-full pulse-dot" :class="c.status === 'online' ? 'bg-success' : 'bg-base-content opacity-30'"></span>
                    <span class="text-xs">{{ c.status }}</span>
                  </div>
                </td>
                <td class="text-xs opacity-60">{{ timeAgo(c.lastHeartbeat) }}</td>
                <td class="text-xs">{{ cpuDisplay(c) }}</td>
                <td class="text-xs">{{ ramDisplay(c) }}</td>
                <td>
                  <div class="flex gap-1">
                    <button class="btn btn-xs btn-ghost" title="Regen API Key" @click="regenWscKey(c.id)">⟳</button>
                    <button class="btn btn-xs btn-ghost text-error" @click="deleteWsc(c.id)">✕</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Virtual Clients -->
    <div class="card bg-base-100 shadow">
      <div class="card-body p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="card-title text-base">Virtual Clients</h2>
          <button class="btn btn-xs btn-primary" @click="openModal('createVc')">+ New</button>
        </div>
        <div v-if="virtualClients.length === 0" class="text-center opacity-40 py-6 text-sm">No virtual clients yet</div>
        <div v-else class="overflow-x-auto">
          <table class="table table-xs">
            <thead>
              <tr><th>ID</th><th>Name</th><th>Status</th><th>Assigned WS</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="vc in virtualClients" :key="vc.id" class="hover cursor-pointer"
                  @click="selectVc(vc)" :class="{ 'bg-base-200': selectedVc?.id === vc.id }">
                <td>
                  <button class="font-mono text-xs link link-hover" @click.stop="copyToClipboard(vc.id)" title="Click to copy">
                    {{ shortId(vc.id) }}
                  </button>
                </td>
                <td class="text-xs">{{ vc.name }}</td>
                <td>
                  <span class="badge badge-xs" :class="vcStatusBadge(vc)">{{ vc.status }}</span>
                </td>
                <td class="font-mono text-xs opacity-60">{{ vc.assignedWsClientId ? shortId(vc.assignedWsClientId) : '—' }}</td>
                <td>
                  <div class="flex gap-1" @click.stop>
                    <button class="btn btn-xs btn-ghost" title="Regen API Key" @click="regenVcKey(vc.id)">⟳</button>
                    <button class="btn btn-xs btn-ghost text-error" @click="deleteVc(vc.id)">✕</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Workspaces (for selected VC) -->
    <div class="card bg-base-100 shadow">
      <div class="card-body p-4">
        <div class="flex items-center justify-between mb-3">
          <h2 class="card-title text-base">
            Workspaces
            <span v-if="selectedVc" class="badge badge-outline badge-sm">{{ selectedVc.name }}</span>
            <span v-if="activeWorkspaceName" class="badge badge-success badge-sm ml-1">Active: {{ activeWorkspaceName }}</span>
            <span v-else-if="selectedVc" class="opacity-40 text-xs font-normal ml-2">(Observer Mode)</span>
            <span v-else class="opacity-40 text-sm font-normal">select a virtual client →</span>
          </h2>
        </div>
        <div v-if="!selectedVc" class="text-center opacity-40 py-6 text-sm">Click a virtual client to see its workspaces</div>
        <div v-else-if="workspaces.length === 0" class="text-center opacity-40 py-6 text-sm">No workspaces yet</div>
        <div v-else class="overflow-x-auto">
          <table class="table table-xs">
            <thead>
              <tr><th>ID</th><th>Name</th><th>Created</th><th>Path</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="ws in workspaces" :key="ws.id" class="hover" :class="{ 'bg-success/10': ws.id === selectedVc.activeWorkspaceId }">
                <td class="font-mono text-xs">
                  {{ shortId(ws.id) }}
                  <span v-if="ws.id === selectedVc.activeWorkspaceId" class="badge badge-success badge-xs ml-2">ACTIVE</span>
                </td>
                <td class="text-xs">{{ ws.name }}</td>
                <td class="text-xs opacity-60">{{ timeAgo(ws.createdAt) }}</td>
                <td class="text-xs opacity-50 max-w-xs truncate" :title="ws.rootPath">{{ ws.rootPath }}</td>
                <td>
                  <button class="btn btn-xs btn-ghost text-error" @click="deleteWorkspace(ws.id)">✕</button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- MCP Sessions -->
    <div class="card bg-base-100 shadow">
      <div class="card-body p-4">
        <h2 class="card-title text-base mb-3">MCP Sessions</h2>
        <div v-if="mcpSessions.length === 0" class="text-center opacity-40 py-6 text-sm">No active MCP sessions</div>
        <div v-else class="overflow-x-auto">
          <table class="table table-xs">
            <thead>
              <tr><th>Session ID</th><th>VC ID</th><th>Last Activity</th></tr>
            </thead>
            <tbody>
              <tr v-for="s in mcpSessions" :key="s.id" class="hover">
                <td class="font-mono text-xs">{{ shortId(s.id) }}</td>
                <td class="font-mono text-xs opacity-60">{{ s.vcId ? shortId(s.vcId) : '—' }}</td>
                <td class="text-xs opacity-60">{{ timeAgo(s.lastActivity) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- ── Modals ────────────────────────────────────────────────────────────── -->

  <!-- Create WS Client Modal -->
  <dialog class="modal" :class="{ 'modal-open': modal === 'createWsc' }">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">New WS Client</h3>
      <div class="form-control gap-3">
        <label class="label"><span class="label-text text-sm">Name</span></label>
        <input class="input input-bordered input-sm" v-model="form.name" placeholder="my-server-node" @keyup.enter="createWsc" />
        <label class="label"><span class="label-text text-sm">Description (optional)</span></label>
        <input class="input input-bordered input-sm" v-model="form.description" placeholder="Production server in US-East" />
      </div>
      <div class="modal-action">
        <button class="btn btn-sm btn-ghost" @click="closeModal">Cancel</button>
        <button class="btn btn-sm btn-primary" @click="createWsc" :disabled="!form.name.trim()">Create</button>
      </div>
    </div>
    <div class="modal-backdrop" @click="closeModal"></div>
  </dialog>

  <!-- Create Virtual Client Modal -->
  <dialog class="modal" :class="{ 'modal-open': modal === 'createVc' }">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-4">New Virtual Client</h3>
      <div class="form-control gap-3">
        <label class="label"><span class="label-text text-sm">Name</span></label>
        <input class="input input-bordered input-sm" v-model="form.name" placeholder="agent-1" @keyup.enter="createVc" />
        <label class="label"><span class="label-text text-sm">Description (optional)</span></label>
        <input class="input input-bordered input-sm" v-model="form.description" placeholder="Research agent" />
      </div>
      <div class="modal-action">
        <button class="btn btn-sm btn-ghost" @click="closeModal">Cancel</button>
        <button class="btn btn-sm btn-primary" @click="createVc" :disabled="!form.name.trim()">Create</button>
      </div>
    </div>
    <div class="modal-backdrop" @click="closeModal"></div>
  </dialog>

  <!-- API Key Reveal Modal -->
  <dialog class="modal" :class="{ 'modal-open': modal === 'apiKey' }">
    <div class="modal-box">
      <h3 class="font-bold text-lg mb-2">{{ apiKeyModal.title }}</h3>
      <p class="text-sm opacity-60 mb-4">{{ apiKeyModal.note }}</p>
      <div class="bg-base-300 rounded-lg p-3 font-mono text-xs break-all select-all">{{ apiKeyModal.key }}</div>
      <div class="modal-action">
        <button class="btn btn-sm btn-ghost" @click="copyToClipboard(apiKeyModal.key); showToast('Copied!')">Copy</button>
        <button class="btn btn-sm btn-primary" @click="closeModal">Done</button>
      </div>
    </div>
    <div class="modal-backdrop" @click="closeModal"></div>
  </dialog>
</div>
  `,

  setup() {
    const wsClients = ref([]);
    const virtualClients = ref([]);
    const workspaces = ref([]);
    const mcpSessions = ref([]);
    const status = ref({});
    const selectedVc = ref(null);
    const loading = ref(false);
    const modal = ref(null);
    const toast = ref('');
    const form = ref({ name: '', description: '' });
    const apiKeyModal = ref({ title: '', key: '', note: '' });
    let refreshTimer = null;
    let toastTimer = null;

    // ── Data loading ──────────────────────────────────────────────────────────
    async function refresh() {
      loading.value = true;
      try {
        const [wscRes, vcRes, statusRes, sessRes] = await Promise.all([
          get('/ws-clients'),
          get('/virtual-clients'),
          get('/status'),
          fetch('/mcp/sessions').then(r => r.json()).catch(() => ({ sessions: [] })),
        ]);
        wsClients.value = wscRes.data || [];
        virtualClients.value = vcRes.data || [];
        status.value = statusRes.data || {};
        mcpSessions.value = sessRes.sessions || [];
        status.value = statusRes.data || {};

        // Sync selectedVc to get latest state (activeWorkspaceId)
        if (selectedVc.value) {
          const fresh = virtualClients.value.find(v => v.id === selectedVc.value.id);
          if (fresh) selectedVc.value = fresh;
        }

        // Refresh workspaces if a VC is selected
        if (selectedVc.value) {
          const ws = await get(`/virtual-clients/${selectedVc.value.id}/workspaces`);
          workspaces.value = ws.data || [];
        }
      } catch (_) {}
      loading.value = false;
    }

    async function selectVc(vc) {
      selectedVc.value = vc;
      const ws = await get(`/virtual-clients/${vc.id}/workspaces`);
      workspaces.value = ws.data || [];
    }

    // ── Modals ────────────────────────────────────────────────────────────────
    function openModal(name) {
      form.value = { name: '', description: '' };
      modal.value = name;
    }
    function closeModal() { modal.value = null; }

    function showApiKey(title, key, note = 'Store this key safely — it will not be shown again.') {
      apiKeyModal.value = { title, key, note };
      modal.value = 'apiKey';
    }

    function showToast(msg, durationMs = 2000) {
      toast.value = msg;
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => { toast.value = ''; }, durationMs);
    }

    // ── WS Client actions ─────────────────────────────────────────────────────
    async function createWsc() {
      if (!form.value.name.trim()) return;
      const res = await post('/ws-clients', { name: form.value.name, description: form.value.description });
      closeModal();
      if (res.ok && res.data?.apiKey) {
        showApiKey(`WS Client Created: ${res.data.name}`, res.data.apiKey,
          `Use this API key with: contextfs client --ws-client-id ${res.data.id} --api-key <key>`);
      }
      await refresh();
    }

    async function deleteWsc(id) {
      if (!confirm('Delete this WS client?')) return;
      await del(`/ws-clients/${id}`);
      await refresh();
      showToast('WS client deleted');
    }

    async function regenWscKey(id) {
      if (!confirm('Regenerate API key? The old key will stop working immediately.')) return;
      const res = await post(`/ws-clients/${id}/regen-key`);
      if (res.ok && res.data?.apiKey) {
        showApiKey('New WS Client API Key', res.data.apiKey,
          'The old key has been invalidated. Update your client configuration.');
      }
    }

    // ── Virtual Client actions ─────────────────────────────────────────────────
    async function createVc() {
      if (!form.value.name.trim()) return;
      const res = await post('/virtual-clients', { name: form.value.name, description: form.value.description });
      closeModal();
      if (res.ok && res.data?.apiKey) {
        showApiKey(`Virtual Client Created: ${res.data.name}`, res.data.apiKey,
          `Use with: CONTEXTFS_VC_ID=${res.data.id} CONTEXTFS_VC_KEY=<key> contextfs chat ...`);
      }
      await refresh();
    }

    async function deleteVc(id) {
      if (!confirm('Delete this virtual client and all its workspaces?')) return;
      await del(`/virtual-clients/${id}`);
      if (selectedVc.value?.id === id) { selectedVc.value = null; workspaces.value = []; }
      await refresh();
      showToast('Virtual client deleted');
    }

    async function regenVcKey(id) {
      if (!confirm('Regenerate API key? The old key will stop working immediately.')) return;
      const res = await post(`/virtual-clients/${id}/regen-key`);
      if (res.ok && res.data?.apiKey) {
        showApiKey('New Virtual Client API Key', res.data.apiKey,
          'The old key has been invalidated. Update your chat/MCP client configuration.');
      }
    }

    async function deleteWorkspace(id) {
      if (!confirm('Delete this workspace?')) return;
      await del(`/virtual-clients/${selectedVc.value.id}/workspaces/${id}`);
      workspaces.value = workspaces.value.filter(w => w.id !== id);
      showToast('Workspace deleted');
      await refresh();
    }

    // ── Display helpers ───────────────────────────────────────────────────────
    const activeWorkspaceName = computed(() => {
      if (!selectedVc.value?.activeWorkspaceId) return null;
      const ws = workspaces.value.find(w => w.id === selectedVc.value.activeWorkspaceId);
      return ws ? ws.name : 'unknown';
    });

    const statusBadge = computed(() => {
      const online = status.value.wsClientsOnline || 0;
      return online > 0 ? 'badge-success' : 'badge-ghost';
    });

    function vcStatusBadge(vc) {
      if (vc.status === 'assigned') return 'badge-success';
      if (vc.status === 'idle') return 'badge-ghost';
      return 'badge-warning';
    }

    function cpuDisplay(c) {
      const load = c.capability?.cpuLoad;
      if (!load || !Array.isArray(load)) return '—';
      return load[0].toFixed(2);
    }

    function ramDisplay(c) {
      const cap = c.capability;
      if (!cap?.totalMemMb) return '—';
      const used = cap.totalMemMb - cap.freeMemMb;
      const pct = Math.round(used / cap.totalMemMb * 100);
      return `${pct}%`;
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────
    onMounted(async () => {
      await refresh();
      refreshTimer = setInterval(refresh, 5000);
    });

    onUnmounted(() => {
      if (refreshTimer) clearInterval(refreshTimer);
    });

    return {
      wsClients, virtualClients, workspaces, mcpSessions, status,
      selectedVc, loading, modal, toast, form, apiKeyModal,
      refresh, selectVc,
      openModal, closeModal, showToast, copyToClipboard,
      createWsc, deleteWsc, regenWscKey,
      createVc, deleteVc, regenVcKey,
      deleteWorkspace,
      statusBadge, vcStatusBadge, cpuDisplay, ramDisplay,
      timeAgo, shortId, activeWorkspaceName
    };
  },
};

createApp(App).mount('#app');
