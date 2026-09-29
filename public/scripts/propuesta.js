import { requireSession } from './api.js';
import { loadAppState, refreshAppState } from './app-state.js';
import { renderSidebar } from './layout.js';

const currentUser = requireSession();
let state;

let items = [
  { title: 'Servicio de Consultoria Marketplace', desc: 'Gestion integral de publicaciones, stock y campanas de publicidad durante 1 mes.', price: 500 }
];

async function boot() {
  state = await loadAppState();
  renderSidebar({ state, currentUser, activePage: 'templates', onRefresh: () => refreshAppState().then(s => { state = s; }) });

  document.getElementById('propDate').valueAsDate = new Date();

  document.getElementById('add-item-btn').addEventListener('click', () => {
    items.push({ title: '', desc: '', price: 0 });
    renderItems();
  });

  document.getElementById('save-proposal-btn').addEventListener('click', saveProposal);
  document.getElementById('pdf-proposal-btn').addEventListener('click', () => window.print());
  document.getElementById('currencySelect').addEventListener('change', calculateTotals);
  document.getElementById('dollarRate').addEventListener('input', calculateTotals);

  renderItems();
  loadSavedProposals();
}

function renderItems() {
  const container = document.getElementById('itemsContainer');
  container.innerHTML = '';

  items.forEach((item, index) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <input type="text" class="item-title-input" value="${esc(item.title)}" placeholder="Nombre del producto o servicio">
        <textarea class="item-desc-input" placeholder="Descripcion breve...">${esc(item.desc)}</textarea>
      </td>
      <td>
        <input type="number" class="item-price-input" value="${item.price}" placeholder="0" step="any">
      </td>
      <td class="no-print">
        <button class="btn-prop-del" type="button">X</button>
      </td>
    `;
    const titleInput = tr.querySelector('.item-title-input');
    const descInput = tr.querySelector('.item-desc-input');
    const priceInput = tr.querySelector('.item-price-input');
    const delBtn = tr.querySelector('.btn-prop-del');

    titleInput.addEventListener('input', () => { items[index].title = titleInput.value; });
    descInput.addEventListener('input', () => { items[index].desc = descInput.value; });
    priceInput.addEventListener('input', () => { items[index].price = parseFloat(priceInput.value) || 0; calculateTotals(); });
    delBtn.addEventListener('click', () => { items.splice(index, 1); renderItems(); });

    container.appendChild(tr);
  });

  calculateTotals();
}

function calculateTotals() {
  const currency = document.getElementById('currencySelect').value;
  const rate = parseFloat(document.getElementById('dollarRate').value) || 1;
  const subtotal = items.reduce((sum, item) => sum + (parseFloat(item.price) || 0), 0);
  const symbol = currency === 'USD' ? 'US$' : '$ ';

  document.getElementById('subtotalVal').textContent = symbol + subtotal.toLocaleString('es-AR');
  document.getElementById('totalVal').textContent = symbol + subtotal.toLocaleString('es-AR');

  const equivRow = document.getElementById('equivRow');
  if (currency === 'USD') {
    const equivARS = subtotal * rate;
    equivRow.textContent = `Equiv. ARS: $ ${equivARS.toLocaleString('es-AR')}`;
  } else {
    const equivUSD = rate > 0 ? (subtotal / rate) : 0;
    equivRow.textContent = `Equiv. USD: US$ ${equivUSD.toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
  }
}

function saveProposal() {
  const client = document.getElementById('clientName').value.trim();
  if (!client) { alert('Ingresa el nombre del cliente antes de guardar.'); return; }

  const proposal = {
    id: Date.now(),
    client,
    date: document.getElementById('propDate').value,
    currency: document.getElementById('currencySelect').value,
    dollarRate: document.getElementById('dollarRate').value,
    items: [...items]
  };

  const saved = JSON.parse(localStorage.getItem('wim_proposals') || '[]');
  saved.push(proposal);
  localStorage.setItem('wim_proposals', JSON.stringify(saved));
  alert('Propuesta guardada.');
  loadSavedProposals();
}

function loadSavedProposals() {
  const container = document.getElementById('savedContainer');
  const saved = JSON.parse(localStorage.getItem('wim_proposals') || '[]');

  if (!saved.length) {
    container.innerHTML = '<p style="color: var(--text-muted); font-size: 0.9rem;">No hay propuestas guardadas.</p>';
    return;
  }

  container.innerHTML = saved.map(prop => `
    <div class="proposal-saved-item" data-prop-id="${prop.id}">
      <div>
        <strong>${esc(prop.client)}</strong> - <small>${esc(prop.date)}</small><br>
        <small style="color: #00d4ff;">Items: ${prop.items.length} | Moneda: ${prop.currency}</small>
      </div>
      <div>
        <button class="btn-prop btn-prop-add" type="button" data-restore="${prop.id}" style="padding:5px 10px;font-size:0.8rem;">Cargar</button>
        <button class="btn-prop-del" type="button" data-delete="${prop.id}">Eliminar</button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('[data-restore]').forEach(btn => {
    btn.addEventListener('click', () => restoreProposal(Number(btn.dataset.restore)));
  });
  container.querySelectorAll('[data-delete]').forEach(btn => {
    btn.addEventListener('click', () => deleteProposal(Number(btn.dataset.delete)));
  });
}

function restoreProposal(id) {
  const saved = JSON.parse(localStorage.getItem('wim_proposals') || '[]');
  const prop = saved.find(p => p.id === id);
  if (!prop) return;
  document.getElementById('clientName').value = prop.client;
  document.getElementById('propDate').value = prop.date;
  document.getElementById('currencySelect').value = prop.currency;
  document.getElementById('dollarRate').value = prop.dollarRate;
  items = [...prop.items];
  renderItems();
}

function deleteProposal(id) {
  let saved = JSON.parse(localStorage.getItem('wim_proposals') || '[]');
  saved = saved.filter(p => p.id !== id);
  localStorage.setItem('wim_proposals', JSON.stringify(saved));
  loadSavedProposals();
}

function esc(str) {
  const div = document.createElement('div');
  div.textContent = str || '';
  return div.innerHTML;
}

boot();
