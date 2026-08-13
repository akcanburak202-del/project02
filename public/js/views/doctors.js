/**
 * Doktor yonetimi: hesap acma, duzenleme, parola sifirlama, acilis devri.
 */

import { api, confirmDialog, fmtSigned, h, openModal, toast } from '../core.js';
import { render, state, withBusy } from '../state.js';

async function loadDoctors() {
  const out = await api.get('/api/doctors');
  state.doctorList = out.doctors;
}

function doctorDialog(existing) {
  openModal((close) => {
    const name = h('input', { type: 'text', value: existing?.name || '' });
    const code = h('input', { type: 'text', value: existing?.code || '', placeholder: 'D01' });
    const title = h('input', { type: 'text', value: existing?.title || '', placeholder: 'Uzm. Dr.' });
    const username = h('input', { type: 'text', value: existing?.username || '' });
    const password = h('input', { type: 'password', placeholder: existing ? 'değiştirmek için doldur' : 'en az 6 karakter' });
    const role = h('select', null,
      h('option', { value: 'doctor', selected: existing?.role !== 'admin' }, 'Doktor'),
      h('option', { value: 'admin', selected: existing?.role === 'admin' }, 'Yönetici'));
    const scheduled = h('input', { type: 'checkbox', checked: existing ? existing.scheduled : true });
    const active = h('input', { type: 'checkbox', checked: existing ? existing.active : true });

    const submit = async () => {
      if (existing) {
        const patch = {
          name: name.value, code: code.value, title: title.value, username: username.value,
          role: role.value, scheduled: scheduled.checked, active: active.checked,
        };
        const ok = await withBusy(() => api.patch(`/api/doctors/${existing.id}`, patch), { success: 'Güncellendi' });
        if (!ok) return;
        if (password.value) {
          const pw = await withBusy(() => api.post(`/api/doctors/${existing.id}/password`, { password: password.value }),
            { success: 'Parola sıfırlandı' });
          if (!pw) return;
        }
      } else {
        const ok = await withBusy(() => api.post('/api/doctors', {
          name: name.value, code: code.value, title: title.value, username: username.value,
          password: password.value, role: role.value, scheduled: scheduled.checked,
        }), { success: 'Doktor eklendi' });
        if (!ok) return;
      }
      close();
      await loadDoctors();
      render();
    };

    return h('div', null,
      h('h3', null, existing ? 'Doktoru düzenle' : 'Yeni doktor'),
      h('div', { class: 'col mt-16' },
        h('label', { class: 'field' }, 'Ad soyad', name),
        h('div', { class: 'row' },
          h('label', { class: 'field grow' }, 'Kısa kod (çizelgede görünür)', code),
          h('label', { class: 'field grow' }, 'Unvan', title)),
        h('label', { class: 'field' }, 'Kullanıcı adı', username),
        h('label', { class: 'field' }, existing ? 'Yeni parola (isteğe bağlı)' : 'Parola', password),
        h('label', { class: 'field' }, 'Rol', role),
        h('label', { class: 'inline' }, scheduled, 'Nöbet listesine dahil edilsin'),
        existing && h('label', { class: 'inline' }, active, 'Hesap aktif')),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onClick: close }, 'Vazgeç'),
        h('button', { class: 'btn btn-primary', onClick: submit }, 'Kaydet')));
  });
}

function openingLedgerDialog(doc) {
  const cats = state.ws?.categories || [
    { key: 'wdSolo', label: 'Haftaiçi paylaşımsız' },
    { key: 'wdShared', label: 'Haftaiçi paylaşımlı' },
    { key: 'weSolo', label: 'Haftasonu paylaşımsız' },
    { key: 'weShared', label: 'Haftasonu paylaşımlı' },
  ];
  openModal((close) => {
    const inputs = {};
    return h('div', null,
      h('h3', null, `${doc.name} — açılış devri`),
      h('p', { class: 'modal-text' },
        'Sistemi kullanmaya başlamadan önceki fazla (+) veya eksik (−) saatleri buraya girerek geçmişi dengeye dahil edebilirsin. ',
        'Pozitif değer "fazla çalışmış" demektir; sonraki aylarda daha az nöbet alır.'),
      h('div', { class: 'col mt-16' },
        cats.map((c) => {
          const input = h('input', { type: 'number', step: '0.5', value: doc.openingLedger?.[c.key] ?? 0 });
          inputs[c.key] = input;
          return h('label', { class: 'field' }, `${c.label} (saat)`, input);
        })),
      h('div', { class: 'modal-actions' },
        h('button', { class: 'btn', onClick: close }, 'Vazgeç'),
        h('button', {
          class: 'btn btn-primary',
          onClick: async () => {
            const openingLedger = {};
            for (const c of cats) openingLedger[c.key] = Number(inputs[c.key].value) || 0;
            const ok = await withBusy(() => api.patch(`/api/doctors/${doc.id}`, { openingLedger }), { success: 'Kaydedildi' });
            if (!ok) return;
            close();
            await loadDoctors();
            render();
          },
        }, 'Kaydet')));
  });
}

export function renderDoctors() {
  if (!state.doctorList) {
    loadDoctors().then(render).catch((e) => toast(e.message, 'error'));
    return h('div', { class: 'empty' }, 'Yükleniyor…');
  }

  const rows = state.doctorList.map((doc) => {
    const ledgerTotal = Object.values(doc.openingLedger || {}).reduce((s, v) => s + (v || 0), 0);
    return h('tr', { style: doc.active ? {} : { opacity: .55 } },
      h('td', null,
        h('div', { style: { fontWeight: 600 } }, doc.name),
        h('div', { class: 'small muted' }, doc.title || '')),
      h('td', { class: 'mono' }, doc.code || '—'),
      h('td', { class: 'mono' }, doc.username),
      h('td', null,
        doc.role === 'admin' ? h('span', { class: 'chip chip-info' }, 'Yönetici') : h('span', { class: 'chip' }, 'Doktor'),
        ' ',
        doc.scheduled ? h('span', { class: 'chip chip-ok' }, 'nöbet tutar') : h('span', { class: 'chip' }, 'nöbet tutmaz')),
      h('td', null, doc.active ? h('span', { class: 'chip chip-ok' }, 'Aktif') : h('span', { class: 'chip chip-danger' }, 'Pasif')),
      h('td', { class: 'num' },
        h('button', { class: 'btn btn-sm btn-ghost', onClick: () => openingLedgerDialog(doc) },
          Math.abs(ledgerTotal) > 0.05 ? fmtSigned(ledgerTotal) : 'ayarla')),
      h('td', { class: 'right nowrap' },
        h('button', { class: 'btn btn-sm', onClick: () => doctorDialog(doc) }, 'Düzenle'),
        ' ',
        h('button', {
          class: 'btn btn-sm',
          onClick: async () => {
            const ok = await confirmDialog(
              `${doc.name} ${doc.active ? 'pasife alınacak ve oturumu kapatılacak' : 'yeniden aktif edilecek'}.`,
              { title: doc.active ? 'Pasife al' : 'Aktif et', danger: doc.active },
            );
            if (!ok) return;
            const done = await withBusy(() => api.patch(`/api/doctors/${doc.id}`, { active: !doc.active }),
              { success: 'Güncellendi' });
            if (!done) return;
            await loadDoctors();
            render();
          },
        }, doc.active ? 'Pasife al' : 'Aktif et')));
  });

  return h('div', null,
    h('div', { class: 'toolbar' },
      h('div', { class: 'grow' },
        h('h2', null, 'Doktorlar'),
        h('div', { class: 'small muted' }, 'Her doktor kendi hesabıyla girip tercihlerini bildirir.')),
      h('button', { class: 'btn btn-primary', onClick: () => doctorDialog(null) }, '+ Yeni doktor')),

    h('div', { class: 'card' },
      h('div', { class: 'card-body tight' },
        h('div', { class: 'table-wrap' },
          h('table', null,
            h('thead', null, h('tr', null,
              h('th', null, 'Ad'), h('th', null, 'Kod'), h('th', null, 'Kullanıcı'),
              h('th', null, 'Rol'), h('th', null, 'Durum'),
              h('th', { class: 'num' }, 'Açılış devri'), h('th', { class: 'right' }, ''))),
            h('tbody', null, rows))))),

    h('div', { class: 'small muted mt-8' },
      'Yeni eklenen doktorlar ilk girişte parolalarını değiştirmek zorundadır. ',
      'Pasife alınan doktor mevcut çizelgelerde görünmeye devam eder ancak yeni aylara otomatik eklenmez.'),
  );
}
