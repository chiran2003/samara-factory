
(async () => {
  // const API_URL = 'http://127.0.0.1:8000';
  const API_URL = 'https://samara-factory.onrender.com';

  // ---------- Utilities ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const fmt = (n) => new Intl.NumberFormat('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0));
  const todayISO = () => new Date().toISOString().slice(0, 10);
  // uid is handled by backend now

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function openModal(title, bodyNode) {
    $('#modalTitle').textContent = title;
    const body = $('#modalBody');
    body.innerHTML = '';
    body.appendChild(bodyNode);
    $('#modal').classList.remove('hidden');
  }
  function closeModal() { $('#modal').classList.add('hidden'); }
  $('#modalClose').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (e) => { if (e.target === $('#modal').firstElementChild) closeModal(); });

  // ---------- State Management ----------
  let state = {
    products: [],
    pos: [],
    ins: [], // loaded on demand per PO usually, but simplicity for now... not scalable for large dataset.
    // We will load per PO or keep a cache. For this demo, we might need a different approach.
    // Let's load full lists for MVP simplicity as per original design.
    outs: [],
    invoices: [],
    history: []
  };

  // Helper fetch wrapper
  async function api(endpoint, options = {}) {
    try {
      const res = await fetch(`${API_URL}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || 'API Error');
      }
      return await res.json();
    } catch (e) {
      toast(`Error: ${e.message}`);
      throw e;
    }
  }

  // Initial Load
  async function loadAll() {
    try {
      // Parallel fetch
      const [prods, pos, outs, invs] = await Promise.all([
        api('/products/'),
        api('/pos/'),
        api('/outs/'),
        api('/invoices/')
      ]);
      state.products = prods;
      state.pos = pos;
      state.outs = outs;
      state.invoices = invs;

      // Stock INs are inside POs ? No, separate endpoint.
      // We will need to fetch INs for displayed POs or cache them.
      // For global search and stats, we might need them all?
      // Let's fetch ins for all known POs? inefficient.
      // Let's change strategy: fetch INs only when needed or load ALL for MVP scale.
      // Since backend doesn't have /ins/ endpoint for all, we might need to add it or iterate.
      // Iterating is bad. We should assume for MVP size we can fetch aggregated data or add an endpoint.
      // But I didn't add GET /ins/ global. I'll rely on on-demand load or specific PO views.
      // HOWEVER, tab 1 table shows total IN. We need that data.
      // I will add a client-side loop to fetch INs for displayed POs or ...
      // BETTER: Add a backend endpoint to get all INs. For now, let's just fetch for relevant POs in view.

      // Wait, to calculate 'remaining' for Tab 2, we need all INs.
      // I'll fetch INs for each PO in the background for now (inefficient but works for 0-50 POs).
      await fetchAllIns();

      renderAll();
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchAllIns() {
    // This is temporary until we have a proper bulk endpoint
    state.ins = [];
    for (const po of state.pos) {
      const ins = await api(`/pos/${po.id}/ins/`);
      state.ins.push(...ins);
    }
  }

  /* 
     NOTE: 
     - Relationships in state are by ID.
     - Backend returns snake_case keys usually? 
       FastAPI Pydantic with orm_mode=True usually returns snake_case by default unless configured to allow camelCase aliases.
       My schemas used snake_case for fields (product_id vs productId).
       I need to adapt the frontend code to use snake_case.
  */

  // ---------- Derived Computations ----------
  const getProduct = (pid) => state.products.find(p => p.id === pid);
  const getPO = (poid) => state.pos.find(p => p.id === poid);
  const poInTotal = (poid) => state.ins.filter(x => x.po_id === poid).reduce((a, b) => a + Number(b.qty || 0), 0);
  const poOutTotal = (poid) => state.outs.filter(x => x.po_id === poid).reduce((a, b) => a + Number(b.qty || 0), 0);
  const poRemainingIn = (poid) => Math.max(0, poInTotal(poid) - poOutTotal(poid));

  // No more local pushHistory, backend handles it.

  // ---------- Tabs ----------
  let activeTab = 0;
  function setActiveTab(tabIndex) {
    $$('.tabPanel').forEach(p => p.classList.add('hidden'));
    $(`#tab${tabIndex}`).classList.remove('hidden');
    $$('.tabBtn').forEach(b => {
      const on = b.dataset.tab === String(tabIndex);
      b.className = 'tabBtn px-3 py-2 rounded-lg text-sm border ' + (on ? 'bg-slate-900 text-white' : 'hover:bg-white');
    });
    activeTab = Number(tabIndex);
  }
  $$('.tabBtn').forEach(b => b.addEventListener('click', () => setActiveTab(b.dataset.tab)));


  // ---------- Global Search ----------
  async function globalSearch(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) { toast('Type something to search'); return; }

    const results = [];
    // Products
    for (const p of state.products) {
      if (p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q)) {
        results.push({ label: `Product: ${p.name} (${p.code})`, tab: 0, focus: { type: 'product', id: p.id } });
      }
      // Materials loaded on demand... cant search them easily without fetching all.
      // Skipping material search for now unless we fetch all materials.
    }

    // POs
    for (const po of state.pos) {
      if (po.po_no.toLowerCase().includes(q)) {
        const p = getProduct(po.product_id);
        results.push({ label: `PO: ${po.po_no} → ${p?.name || ''} (${p?.code || ''})`, tab: 1, focus: { type: 'po', id: po.id, productId: po.product_id } });
      }
    }

    // Invoices
    for (const inv of state.invoices) {
      if (inv.invoice_no.toLowerCase().includes(q)) {
        results.push({ label: `Invoice: ${inv.invoice_no} (${inv.status})`, tab: 3, focus: { type: 'invoice', id: inv.id } });
      }
    }

    // OUTs
    for (const out of state.outs) {
      const po = getPO(out.po_id);
      const p = getProduct(out.product_id);
      const hay = `${p?.name || ''} ${p?.code || ''} ${po?.po_no || ''} ${out.invoice_id ? (state.invoices.find(i => i.id === out.invoice_id)?.invoice_no || '') : ''}`.toLowerCase();
      if (hay.includes(q)) {
        results.push({ label: `OUT: ${out.date} · ${p?.code || ''} · ${po?.po_no || ''} · Qty ${out.qty}`, tab: 2, focus: { type: 'out', id: out.id, productId: out.product_id } });
      }
    }

    const wrap = document.createElement('div');
    wrap.className = 'space-y-3';
    const top = document.createElement('div');
    top.className = 'text-sm text-slate-600';
    top.textContent = `Found ${results.length} result(s) for “${query}”`;
    wrap.appendChild(top);

    if (results.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'rounded-xl border bg-slate-50 p-4 text-sm text-slate-600';
      empty.textContent = 'No matches found.';
      wrap.appendChild(empty);
    } else {
      const list = document.createElement('div');
      list.className = 'rounded-xl border overflow-hidden';
      const ul = document.createElement('div');
      ul.className = 'divide-y bg-white';
      results.slice(0, 30).forEach(r => {
        const row = document.createElement('button');
        row.className = 'w-full text-left px-4 py-3 hover:bg-slate-50 flex items-center justify-between gap-2';
        row.innerHTML = `<div class="text-sm">${r.label}</div><div class="text-xs text-slate-500">Open Tab ${r.tab}</div>`;
        row.addEventListener('click', () => {
          closeModal();
          setActiveTab(r.tab);
          focusRecord(r.focus);
        });
        ul.appendChild(row);
      });
      list.appendChild(ul);
      wrap.appendChild(list);
    }
    openModal('🔎 Global Search Results', wrap);
  }
  $('#btnSearch').addEventListener('click', () => globalSearch($('#globalSearch').value));
  $('#globalSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') globalSearch($('#globalSearch').value); });


  // ---------- Focus helpers ----------
  let selectedProductTab1 = null;
  let selectedProductTab2 = null;
  let selectedInvoiceId = null;

  function focusRecord(focus) {
    if (!focus) return;
    if (focus.type === 'product' || focus.type === 'material') {
      // We might need to fetch materials if focus is material
      renderTab0(focus);
      return;
    }
    if (focus.type === 'po') {
      selectedProductTab1 = focus.productId;
      renderTab1();
      setTimeout(() => {
        const row = document.querySelector(`[data-po-row="${focus.id}"]`);
        if (row) { row.classList.add('bg-blue-50'); row.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }, 50);
      return;
    }
    if (focus.type === 'out') {
      selectedProductTab2 = focus.productId;
      renderTab2();
      setTimeout(() => {
        const row = document.querySelector(`[data-out-row="${focus.id}"]`);
        if (row) { row.classList.add('bg-blue-50'); row.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      }, 50);
      return;
    }
    if (focus.type === 'invoice') {
      selectedInvoiceId = focus.id;
      renderTab3();
      openInvoiceView(focus.id);
      return;
    }
  }


  // ---------- TAB 0 Render + Actions ----------
  async function renderTab0(focus = null) {
    const tb = $('#productsTbody');
    tb.innerHTML = '';
    const products = state.products;

    if (products.length === 0) {
      tb.innerHTML = `<tr><td class="px-4 py-4 text-slate-500" colspan="4">No products found. Add one to get started.</td></tr>`;
    }

    for (const p of products) {
      const tr = document.createElement('tr');
      tr.dataset.productRow = p.id;
      tr.className = 'hover:bg-slate-50';
      tr.innerHTML = `
        <td class="px-4 py-3">
          <div class="font-medium">${p.name}</div>
          <div class="text-xs text-slate-500">ID: ${p.id.slice(0, 8)}...</div>
        </td>
        <td class="px-4 py-3"><span class="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-1 text-xs font-semibold text-white">${p.code}</span></td>
        <td class="px-4 py-3 text-right font-semibold">${fmt(p.rate)}</td>
        <td class="px-4 py-3 text-right">
          <div class="inline-flex items-center gap-2">
            <button class="btnMaterials px-3 py-1.5 rounded-lg border text-xs hover:bg-slate-50" data-pid="${p.id}">▼ View Materials</button>
            <button class="btnEditProduct px-3 py-1.5 rounded-lg border text-xs hover:bg-slate-50" data-pid="${p.id}">Edit</button>
            <button class="btnDeleteProduct px-3 py-1.5 rounded-lg border text-xs hover:bg-rose-50 text-rose-600" data-pid="${p.id}">Delete</button>
          </div>
        </td>
      `;
      tb.appendChild(tr);

      // Material Row
      const matRow = document.createElement('tr');
      matRow.className = 'hidden';
      matRow.dataset.matPanel = p.id;
      matRow.innerHTML = `
        <td colspan="4" class="px-4 pb-4">
          <div class="mt-1 rounded-xl border bg-slate-50 p-3">
            <div class="flex items-center justify-between gap-3">
              <div>
                <div class="font-semibold">Materials for ${p.code}</div>
              </div>
              <button class="btnAddMaterial px-3 py-2 rounded-lg bg-slate-900 text-white text-xs hover:bg-slate-800" data-pid="${p.id}">➕ Add Material</button>
            </div>
            <div class="mt-3 rounded-lg border bg-white overflow-hidden">
              <table class="min-w-full text-sm" id="matTable_${p.id}">
                <tbody class="divide-y"><tr><td class="p-4 text-slate-500">Loading...</td></tr></tbody>
              </table>
            </div>
          </div>
        </td>
      `;
      tb.appendChild(matRow);
    }

    // Wiring
    $$('.btnMaterials').forEach(btn => btn.addEventListener('click', async () => {
      const pid = btn.dataset.pid;
      const panel = document.querySelector(`[data-mat-panel="${pid}"]`);
      const open = !panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      btn.textContent = open ? '▼ View Materials' : '▲ Hide Materials';
      if (!open) {
        // Load materials
        const mats = await api(`/products/${pid}/materials/`);
        const tbody = document.querySelector(`#matTable_${pid} tbody`);
        if (mats.length === 0) {
          tbody.innerHTML = `<tr><td class="px-3 py-3 text-sm text-slate-500" colspan="2">No materials yet.</td></tr>`;
        } else {
          tbody.innerHTML = mats.map(m => `
            <tr>
              <td class="px-3 py-2">${m.name}</td>
              <td class="px-3 py-2 text-right">
                <button class="btnDeleteMaterial px-2 py-1 rounded-lg border text-xs hover:bg-slate-50" data-mid="${m.id}">Delete</button>
              </td>
            </tr>
          `).join('');

          tbody.querySelectorAll('.btnDeleteMaterial').forEach(b => b.addEventListener('click', async () => {
            if (confirm('Delete material?')) {
              await api(`/materials/${b.dataset.mid}`, { method: 'DELETE' });
              toast('Material deleted');
              btn.click(); btn.click(); // reload toggle hack
            }
          }));
        }
        panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }));

    $$('.btnEditProduct').forEach(btn => btn.addEventListener('click', () => editProduct(btn.dataset.pid)));
    $$('.btnAddMaterial').forEach(btn => btn.addEventListener('click', () => addMaterial(btn.dataset.pid)));
    $$('.btnDeleteProduct').forEach(btn => btn.addEventListener('click', async () => {
      const pid = btn.dataset.pid;
      const p = getProduct(pid);
      if (confirm(`Are you sure you want to delete "${p.name}"? This will hide it from new operations.`)) {
        try {
          await api(`/products/${pid}`, { method: 'DELETE' });
          toast('Product deleted');
          loadAll();
        } catch (e) { }
      }
    }));
  }

  function addProduct() {
    const wrap = document.createElement('div');
    wrap.className = 'space-y-3';
    wrap.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="text-sm">Product Name <input id="pName" class="mt-1 w-full rounded-lg border px-3 py-2" /></label>
        <label class="text-sm">Product Code <input id="pCode" class="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      </div>
      <label class="text-sm">OE Pay (LKR) <input id="pRate" type="number" step="0.01" class="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <div class="flex items-center justify-end gap-2 pt-2">
        <button id="save" class="px-4 py-2 rounded-xl bg-slate-900 text-white">Save</button>
      </div>
    `;
    wrap.querySelector('#save').addEventListener('click', async () => {
      const name = wrap.querySelector('#pName').value.trim();
      const code = wrap.querySelector('#pCode').value.trim();
      const rate = Number(wrap.querySelector('#pRate').value);
      if (!name || !code) return toast('Fill all fields');

      await api('/products/', {
        method: 'POST',
        body: JSON.stringify({ name, code, rate })
      });
      toast('Product added');
      closeModal();
      loadAll();
    });
    openModal('➕ Add New Product', wrap);
  }

  function addMaterial(pid) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <label class="text-sm">Material Name <input id="mName" class="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <div class="flex items-center justify-end gap-2 pt-2">
        <button id="save" class="px-4 py-2 rounded-xl bg-slate-900 text-white">Add</button>
      </div>
    `;
    wrap.querySelector('#save').addEventListener('click', async () => {
      const name = wrap.querySelector('#mName').value.trim();
      if (!name) return toast('Enter name');
      await api('/materials/', {
        method: 'POST',
        body: JSON.stringify({ name, product_id: pid })
      });
      toast('Material added');
      closeModal();
      // Refresh materials view if open... simpler to let user toggle again or we refresh global?
      // For now, simple.
      toast('Re-open material view to see changes');
    });
    openModal('Add Material', wrap);
  }

  function editProduct(pid) {
    const p = getProduct(pid);
    if (!p) return;
    const wrap = document.createElement('div');
    wrap.className = 'space-y-3';
    wrap.innerHTML = `
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label class="text-sm">Product Name
          <input id="pName" class="mt-1 w-full rounded-lg border px-3 py-2" value="${p.name}" />
        </label>
        <label class="text-sm">Product Code
          <input id="pCode" class="mt-1 w-full rounded-lg border px-3 py-2" value="${p.code}" />
        </label>
      </div>
      <label class="text-sm">OE Pay (LKR)
        <input id="pRate" type="number" step="0.01" class="mt-1 w-full rounded-lg border px-3 py-2" value="${p.rate}" />
      </label>
      <div class="flex items-center justify-end gap-2 pt-2">
        <button id="save" class="px-4 py-2 rounded-xl bg-slate-900 text-white">Update</button>
      </div>
    `;

    // Set initial values
    wrap.querySelector('#pName').value = p.name;
    wrap.querySelector('#pCode').value = p.code;
    wrap.querySelector('#pRate').value = p.rate;

    wrap.querySelector('#save').addEventListener('click', async () => {
      const name = wrap.querySelector('#pName').value.trim();
      const code = wrap.querySelector('#pCode').value.trim();
      const rate = Number(wrap.querySelector('#pRate').value);
      if (!name || !code) return toast('Fill all fields');

      try {
        await api(`/products/${pid}`, {
          method: 'PUT',
          body: JSON.stringify({ name, code, rate })
        });
        toast('Product updated');
        closeModal();
        loadAll();
      } catch (e) { }
    });
    openModal('Edit Product', wrap);
  }

  $('#addProduct').addEventListener('click', addProduct);


  // ---------- TAB 1 Render + Actions ----------
  function renderTab1() {
    const list = $('#stockProductList');
    list.innerHTML = '';
    state.products.forEach(p => {
      const btn = document.createElement('button');
      const active = selectedProductTab1 === p.id;
      btn.className = 'w-full text-left px-3 py-2 rounded-xl border ' + (active ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 bg-white');
      btn.innerHTML = `<div class="font-medium">${p.name}</div><div class="text-xs ${active ? 'text-white/70' : 'text-slate-500'}">${p.code}</div>`;
      btn.addEventListener('click', () => { selectedProductTab1 = p.id; renderTab1(); });
      list.appendChild(btn);
    });

    const sel = selectedProductTab1 ? getProduct(selectedProductTab1) : null;
    $('#stockSelectedProduct').textContent = sel ? `Product: ${sel.name} (${sel.code})` : 'Select a product to view POs';
    $('#addPO').disabled = !sel;

    const tb = $('#poTbody');
    tb.innerHTML = '';

    if (!sel) {
      tb.innerHTML = `<tr><td class="px-4 py-4 text-slate-500" colspan="5">Select a product.</td></tr>`;
      return;
    }

    const pos = state.pos.filter(po => po.product_id === sel.id);
    if (pos.length === 0) {
      tb.innerHTML = `<tr><td class="px-4 py-4 text-slate-500" colspan="5">No POs yet.</td></tr>`;
    } else {
      pos.forEach(po => {
        const totalIn = poInTotal(po.id);
        const rem = Math.max(0, po.po_qty - poOutTotal(po.id)); // Actually logic was IN - OUT. Wait. 
        // Logic check:
        // Remaining IN: Total IN - Total OUT. (Stock on hand)
        // PO Qty is target.
        // Wait, original app "Remaining IN" meant "Stock currently in warehouse". 
        // Yes: IN - OUT.
        const stockOnHand = poRemainingIn(po.id);

        const tr = document.createElement('tr');
        tr.dataset.poRow = po.id;
        tr.className = 'hover:bg-slate-50';
        tr.innerHTML = `
          <td class="px-4 py-3 font-medium">${po.po_no}</td>
          <td class="px-4 py-3 text-right">${po.po_qty}</td>
          <td class="px-4 py-3 text-right font-semibold">${totalIn}</td>
          <td class="px-4 py-3 text-right">
            <span class="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold ${stockOnHand > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}">${stockOnHand}</span>
          </td>
          <td class="px-4 py-3 text-right">
            <button class="btnInHistory px-3 py-1.5 rounded-lg border text-xs hover:bg-slate-50" data-poid="${po.id}">📜 IN History</button>
          </td>
        `;
        tb.appendChild(tr);
      });
      $$('.btnInHistory').forEach(b => b.addEventListener('click', () => openInHistory(b.dataset.poid)));
    }
  }

  function addPO() {
    const sel = getProduct(selectedProductTab1);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div class="text-sm font-semibold mb-2">${sel.name}</div>
      <label class="text-sm">PO Number <input id="poNo" class="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <label class="text-sm mt-2">PO Qty <input id="poQty" type="number" class="mt-1 w-full rounded-lg border px-3 py-2" /></label>
      <div class="flex items-center justify-end gap-2 pt-2">
        <button id="save" class="px-4 py-2 rounded-xl bg-slate-900 text-white">Create</button>
      </div>
    `;
    wrap.querySelector('#save').addEventListener('click', async () => {
      const no = wrap.querySelector('#poNo').value;
      const qty = Number(wrap.querySelector('#poQty').value);
      if (!no || !qty) return toast('Invalid input');

      try {
        await api('/pos/', {
          method: 'POST',
          body: JSON.stringify({ product_id: sel.id, po_no: no, po_qty: qty })
        });
        toast('PO Created');
        closeModal();
        loadAll();
      } catch (e) {
        // error toast handled by api wrapper
      }
    });
    openModal('New PO', wrap);
  }
  $('#addPO').addEventListener('click', addPO);

  async function openInHistory(poid) {
    // Refresh INs for this PO
    const ins = await api(`/pos/${poid}/ins/`);
    // Update local state cache
    // Remove old INs for this PO
    state.ins = state.ins.filter(i => i.po_id !== poid).concat(ins);

    // Render modal
    const po = getPO(poid);
    const wrap = document.createElement('div');
    wrap.innerHTML = `
     <div class="mb-3 text-sm font-bold">PO: ${po.po_no}</div>
     <table class="w-full text-sm mb-3">
       <thead><tr><th class="text-left">Date</th><th class="text-right">Qty</th><th>Note</th><th class="text-right">Actions</th></tr></thead>
       <tbody>
         ${ins.map(i => `
           <tr class="border-b">
             <td class="py-2">${i.date}</td>
             <td class="text-right py-2">${i.qty}</td>
             <td class="py-2 px-2">${i.note || ''}</td>
             <td class="text-right py-2">
                <button class="text-xs border rounded px-2 py-1 hover:bg-slate-100 btnEditIn" data-id="${i.id}">Edit</button>
                <button class="text-xs border rounded px-2 py-1 text-rose-600 hover:bg-rose-50 btnDeleteIn" data-id="${i.id}">Del</button>
             </td>
           </tr>`).join('')}
       </tbody>
     </table>
     <button id="addIn" class="w-full py-2 bg-slate-900 text-white rounded-xl text-sm">Add Stock IN</button>
  `;

    // --- Add Event Listeners ---
    wrap.querySelector('#addIn').addEventListener('click', () => {
      closeModal();
      addInEntry(poid);
    });

    wrap.querySelectorAll('.btnEditIn').forEach(btn => {
      btn.addEventListener('click', () => {
        const inId = btn.dataset.id;
        const entry = ins.find(i => i.id === inId);
        closeModal();
        editInEntry(entry);
      });
    });

    wrap.querySelectorAll('.btnDeleteIn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm("Delete this Stock IN entry?")) return;
        try {
          await api(`/ins/${btn.dataset.id}`, { method: 'DELETE' });
          toast("Entry deleted");
          openInHistory(poid); // Refresh modal
          loadAll(); // Refresh background stats
        } catch (e) {
          console.error(e);
        }
      });
    });

    openModal('Stock IN History', wrap);
  }

  function editInEntry(entry) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <label class="text-sm">Date <input id="date" type="date" class="w-full border rounded p-2" value="${entry.date}"/></label>
      <label class="text-sm mt-2">Qty <input id="qty" type="number" class="w-full border rounded p-2" value="${entry.qty}"/></label>
      <label class="text-sm mt-2">Note <input id="note" class="w-full border rounded p-2" value="${entry.note || ''}"/></label>
      <button id="save" class="mt-3 w-full py-2 bg-slate-900 text-white rounded">Update</button>
    `;
    wrap.querySelector('#save').addEventListener('click', async () => {
      const date = wrap.querySelector('#date').value;
      const qty = Number(wrap.querySelector('#qty').value);
      const note = wrap.querySelector('#note').value;

      try {
        await api(`/ins/${entry.id}`, {
          method: 'PUT',
          body: JSON.stringify({ po_id: entry.po_id, date, qty, note })
        });
        toast('Stock IN Updated');
        closeModal();
        openInHistory(entry.po_id); // Re-open history to show change
        loadAll();
      } catch (e) { }
    });
    openModal('Edit Stock IN', wrap);
  }

  function addInEntry(poid) {
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <label class="text-sm">Date <input id="date" type="date" class="w-full border rounded p-2" value="${todayISO()}"/></label>
      <label class="text-sm mt-2">Qty <input id="qty" type="number" class="w-full border rounded p-2"/></label>
      <label class="text-sm mt-2">Note <input id="note" class="w-full border rounded p-2"/></label>
      <button id="save" class="mt-3 w-full py-2 bg-slate-900 text-white rounded">Save</button>
    `;
    wrap.querySelector('#save').addEventListener('click', async () => {
      const date = wrap.querySelector('#date').value;
      const qty = Number(wrap.querySelector('#qty').value);
      const note = wrap.querySelector('#note').value;

      try {
        await api('/ins/', {
          method: 'POST',
          body: JSON.stringify({ po_id: poid, date, qty, note })
        });
        toast('Stock IN Added');
        closeModal();
        openInHistory(poid);
        loadAll();
      } catch (e) { }
    });
    openModal('Add Stock IN', wrap);
  }


  // ---------- TAB 2 Render + Actions ----------
  let selectedOutIds = new Set();

  function renderTab2() {
    const list = $('#outProductList');
    list.innerHTML = '';
    state.products.forEach(p => {
      const btn = document.createElement('button');
      const active = selectedProductTab2 === p.id;
      btn.className = 'w-full text-left px-3 py-2 rounded-xl border ' + (active ? 'bg-slate-900 text-white' : 'hover:bg-slate-50 bg-white');
      btn.innerHTML = `<div class="font-medium">${p.name}</div>`;
      btn.addEventListener('click', () => { selectedProductTab2 = p.id; selectedOutIds.clear(); renderTab2(); });
      list.appendChild(btn);
    });

    const sel = selectedProductTab2 ? getProduct(selectedProductTab2) : null;
    $('#outSelectedProduct').textContent = sel ? `Product: ${sel.name}` : 'Select a product';
    $('#makeOut').disabled = !sel;

    const sBody = $('#poSummaryTbody');
    sBody.innerHTML = '';

    if (sel) {
      const pos = state.pos.filter(po => po.product_id === sel.id);
      pos.forEach(po => {
        const tr = document.createElement('tr');
        const in_ = poInTotal(po.id);
        const out_ = poOutTotal(po.id);
        tr.innerHTML = `
          <td class="px-4 py-3">${po.po_no}</td>
          <td class="px-4 py-3 text-right">${po.po_qty}</td>
          <td class="px-4 py-3 text-right">${in_}</td>
          <td class="px-4 py-3 text-right">${out_}</td>
          <td class="px-4 py-3 text-right">${in_ - out_}</td>
        `;
        sBody.appendChild(tr);
      });
    }

    // OUTs Table
    const outBody = $('#outTbody');
    outBody.innerHTML = '';
    // Show all outs, sorted by date
    // If product selected, maybe highlight or filter? Original showed all but highlighted.
    // Let's filter by product if selected, or show all if not? 
    // Original: "OUT rows (show all outs, but we highlight selected product first)"
    // Let's just show all for simplicity, but filter logic is nice.
    const outs = state.outs; // .sort(...)

    outs.forEach(o => {
      const p = getProduct(o.product_id);
      const po = getPO(o.po_id);
      const inv = state.invoices.find(i => i.id === o.invoice_id);
      const isSel = selectedOutIds.has(o.id);

      const tr = document.createElement('tr');
      tr.dataset.outRow = o.id;
      tr.className = (sel && o.product_id !== sel.id ? 'opacity-50 ' : '') + 'hover:bg-slate-50';
      tr.innerHTML = `
         <td class="px-4 py-3"><input type="checkbox" class="outCheck" data-id="${o.id}" ${inv ? 'disabled' : ''} ${isSel ? 'checked' : ''} /></td>
         <td class="px-4 py-3">${o.date}</td>
         <td class="px-4 py-3">${p?.name}</td>
         <td class="px-4 py-3">${p?.code}</td>
         <td class="px-4 py-3">${po?.po_no}</td>
         <td class="px-4 py-3 text-right font-semibold">${o.qty}</td>
         <td class="px-4 py-3">${o.note || ''}</td>
         <td class="px-4 py-3">${inv ? inv.invoice_no : '-'}</td>
       `;
      outBody.appendChild(tr);
    });

    $$('.outCheck').forEach(chk => chk.addEventListener('change', () => {
      if (chk.checked) selectedOutIds.add(chk.dataset.id);
      else selectedOutIds.delete(chk.dataset.id);
      $('#genInvoice').disabled = selectedOutIds.size === 0;
    }));
    $('#genInvoice').disabled = selectedOutIds.size === 0;
  }

  function makeNewOut() {
    // Similar modal to original, fetch backend to save
    const products = state.products;
    const wrap = document.createElement('div');
    // ... (simplify HTML generation for brevity, assume similar structure) ...
    // Logic:
    // - Select Product
    // - Select PO (dynamic)
    // - Enter Qty
    // - Backend API POST /outs/

    wrap.innerHTML = `
        <label>Date <input id="date" type="date" value="${todayISO()}" class="border p-1"/></label>
        <label>Product <select id="prod" class="border p-1 w-full">${products.map(p => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
        <label>PO <select id="po" class="border p-1 w-full"></select></label>
        <label>Qty <input id="qty" type="number" class="border p-1 w-full"/></label>
        <button id="save" class="bg-black text-white p-2 rounded w-full mt-3">Save</button>
     `;

    const prodSel = wrap.querySelector('#prod');
    const poSel = wrap.querySelector('#po');

    const updatePos = () => {
      const pid = prodSel.value;
      const pos = state.pos.filter(x => x.product_id === pid);
      poSel.innerHTML = pos.map(x => `<option value="${x.id}">${x.po_no}</option>`).join('');
    };
    prodSel.addEventListener('change', updatePos);
    updatePos();

    wrap.querySelector('#save').addEventListener('click', async () => {
      const date = wrap.querySelector('#date').value;
      const pid = prodSel.value;
      const poid = poSel.value;
      const qty = Number(wrap.querySelector('#qty').value);

      try {
        await api('/outs/', {
          method: 'POST',
          body: JSON.stringify({ product_id: pid, po_id: poid, date, qty })
        });
        toast('OUT Saved');
        closeModal();
        loadAll();
      } catch (e) { }
    });
    openModal('New OUT', wrap);
  }
  $('#makeOut').addEventListener('click', makeNewOut);

  $('#genInvoice').addEventListener('click', async () => {
    if (selectedOutIds.size === 0) return;
    try {
      await api('/invoices/', {
        method: 'POST',
        body: JSON.stringify({ out_ids: Array.from(selectedOutIds) })
      });
      toast('Invoice Created');
      selectedOutIds.clear();
      loadAll();
      setActiveTab(3);
    } catch (e) { }
  });


  // ---------- TAB 3 Render + Actions ----------
  function renderTab3() {
    const tb = $('#invoiceTbody');
    tb.innerHTML = '';
    state.invoices.forEach(inv => {
      // Calculate total locally or fetch?
      // We have OUTs in state.
      // Filter OUTs for this invoice
      const invOuts = state.outs.filter(o => o.invoice_id === inv.id);
      let total = 0;
      invOuts.forEach(o => {
        const p = getProduct(o.product_id);
        total += (o.qty * (p?.rate || 0));
      });

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="px-4 py-3 font-medium">${inv.invoice_no}</td>
        <td class="px-4 py-3">${inv.date}</td>
        <td class="px-4 py-3 text-right">${invOuts.length}</td>
        <td class="px-4 py-3 text-right font-bold">${fmt(total)}</td>
        <td class="px-4 py-3">${inv.status}</td>
        <td class="px-4 py-3 text-right">
          <button class="viewBtn px-2 py-1 border rounded" data-id="${inv.id}">View</button>
        </td>
      `;
      tb.appendChild(tr);
    });
    $$('.viewBtn').forEach(b => b.addEventListener('click', () => openInvoiceView(b.dataset.id)));
  }

  function openInvoiceView(invId) {
    const inv = state.invoices.find(i => i.id === invId);
    if (!inv) return;
    selectedInvoiceId = invId;

    const v = $('#invoiceView');
    v.classList.remove('hidden');
    // Hide list
    $('#invoiceListWrap').classList.add('hidden');
    $('#closeInvoiceView').classList.remove('hidden'); // This button needs to exist in HTML or be managed

    $('#invTitle').textContent = `Invoice ${inv.invoice_no}`;

    // Status Logic
    const statusColors = { 'Draft': 'bg-gray-100 text-gray-800', 'Ready': 'bg-blue-100 text-blue-800', 'Printed': 'bg-green-100 text-green-800' };
    $('#invMeta').innerHTML = `<span class="px-2 py-1 rounded ${statusColors[inv.status] || ''}">${inv.status}</span>`;

    // Items
    const invOuts = state.outs.filter(o => o.invoice_id === inv.id);
    const tbody = $('#invItemsTbody');
    tbody.innerHTML = '';
    let total = 0;
    invOuts.forEach(o => {
      const p = getProduct(o.product_id);
      const po = getPO(o.po_id);
      const sub = o.qty * (p?.rate || 0);
      total += sub;

      const removeBtn = (inv.status !== 'Printed')
        ? `<button class="text-xs text-rose-500 hover:bg-rose-50 border rounded px-2 py-1 ml-2 btnRemoveItem" data-oid="${o.id}">Remove</button>`
        : '';

      const tr = document.createElement('tr');
      tr.innerHTML = `
           <td class="p-2">${p?.name}</td>
           <td class="p-2">${p?.code}</td>
           <td class="p-2">${po?.po_no}</td>
           <td class="p-2 text-right">${o.qty}</td>
           <td class="p-2 text-right">${fmt(p?.rate)}</td>
           <td class="p-2 text-right flex justify-end items-center gap-2">
             ${fmt(sub)}
             ${removeBtn}
           </td>
       `;
      tbody.appendChild(tr);
    });
    $('#invTotal').textContent = fmt(total);

    // Remove Item Logic
    tbody.querySelectorAll('.btnRemoveItem').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm("Remove this item from invoice? It will return to 'Stock OUT' list.")) return;
        try {
          await api(`/invoices/${inv.id}/items/${btn.dataset.oid}`, { method: 'DELETE' });
          toast('Item removed');
          loadAll();
          setTimeout(() => openInvoiceView(invId), 500); // Reload view
        } catch (e) { }
      });
    });

    // Control Bar Injection
    // Check if controls already injected? simpler to just rewrite header/controls area if possible
    // Or just replace the buttons area.
    const btnArea = $('#toggleStatus').parentElement;
    // Clear old buttons except Print/History if we want, or just rebuild:
    btnArea.innerHTML = '';

    // 1. Status Selector
    const sel = document.createElement('select');
    sel.className = 'rounded-lg border px-3 py-2 text-sm';
    sel.innerHTML = `
        <option value="Draft" ${inv.status === 'Draft' ? 'selected' : ''}>Draft</option>
        <option value="Ready" ${inv.status === 'Ready' ? 'selected' : ''}>Ready</option>
        <option value="Printed" ${inv.status === 'Printed' ? 'selected' : ''}>Printed</option>
    `;
    sel.onchange = async () => {
      try {
        await api(`/invoices/${inv.id}/status?status_val=${sel.value}`, { method: 'PUT' });
        toast(`Status changed to ${sel.value}`);
        loadAll(); // Background update
        inv.status = sel.value; // Local update
        // Update UI color
        $('#invMeta').innerHTML = `<span class="px-2 py-1 rounded ${statusColors[inv.status] || ''}">${inv.status}</span>`;
        // Re-render to update permissions (e.g. hide remove buttons if printed)
        openInvoiceView(invId);
      } catch (e) { sel.value = inv.status; } // Revert on error
    };
    btnArea.appendChild(sel);

    // 2. Add Items Button (Only if not Printed)
    if (inv.status !== 'Printed') {
      const addBtn = document.createElement('button');
      addBtn.className = 'px-4 py-2 rounded-xl bg-slate-900 text-white text-sm hover:bg-slate-800 ml-2';
      addBtn.textContent = '➕ Add Items';
      addBtn.onclick = () => openAddItemsModal(inv);
      btnArea.appendChild(addBtn);
    }

    // 3. Print
    const printBtn = document.createElement('button');
    printBtn.className = 'px-4 py-2 rounded-xl border text-sm hover:bg-white ml-2';
    printBtn.textContent = '🖨️ Print';
    printBtn.onclick = () => window.print();
    btnArea.appendChild(printBtn);
  }

  function openAddItemsModal(inv) {
    // Find all Available OUTs (invoice_id is null)
    const available = state.outs.filter(o => !o.invoice_id);
    if (available.length === 0) return toast("No uninvoiced items available.");

    const wrap = document.createElement('div');
    wrap.innerHTML = `
          <div class="mb-3 text-sm text-slate-500">Select items to add to Invoice ${inv.invoice_no}:</div>
          <div class="max-h-60 overflow-y-auto border rounded p-2 space-y-2">
            ${available.map(o => {
      const p = getProduct(o.product_id);
      return `
                <label class="flex items-center gap-3 p-2 hover:bg-slate-50 border-b cursor-pointer">
                    <input type="checkbox" class="add-check" value="${o.id}">
                    <div class="text-sm">
                        <div class="font-bold">${p?.name}</div>
                        <div class="text-xs text-slate-500">Qty: ${o.qty} · ${o.date}</div>
                    </div>
                </label>`;
    }).join('')}
          </div>
          <button id="confirmAdd" class="mt-3 w-full py-2 bg-slate-900 text-white rounded-xl text-sm">Add Selected</button>
      `;
    wrap.querySelector('#confirmAdd').onclick = async () => {
      const ids = Array.from(wrap.querySelectorAll('.add-check:checked')).map(cb => cb.value);
      if (ids.length === 0) return toast("Select at least one item");

      try {
        // Fix: use Pydantic model structure expected by backend
        await api(`/invoices/${inv.id}/items`, {
          method: 'POST',
          body: JSON.stringify({ out_ids: ids })
        });
        toast("Items added");
        closeModal();
        loadAll();
        setTimeout(() => openInvoiceView(inv.id), 500);
      } catch (e) { }
    };
    openModal('Add Items to Invoice', wrap);
  }

  $('#closeInvoiceView').addEventListener('click', () => {
    $('#invoiceView').classList.add('hidden');
    $('#invoiceListWrap').classList.remove('hidden'); // Show list again
    $('#closeInvoiceView').classList.add('hidden');
    selectedInvoiceId = null;
  });


  // ---------- Global History ----------
  $('#btnHistory').addEventListener('click', async () => {
    try {
      const logs = await api('/history/');
      const wrap = document.createElement('div');
      wrap.innerHTML = logs.map(l => `
        <div class="border-b result-item p-2">
           <div class="font-bold text-xs">${l.action}</div>
           <div class="text-sm">${l.details}</div>
           <div class="text-xs text-gray-500">${l.ts}</div>
        </div>
      `).join('');
      openModal('Global History', wrap);
    } catch (e) { }
  });

  // ---------- Init ----------
  function renderAll() {
    renderTab0();
    renderTab1();
    renderTab2();
    renderTab3();
  }

  // Start
  loadAll();

})();
