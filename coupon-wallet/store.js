/* 쿠폰 지갑 - IndexedDB 저장소 + 알림 점검. 화면(app.js)과 서비스워커(sw.js)가 같은 DB를 사용함. */
(function (root) {
  'use strict';

  const NAME = 'coupon-wallet';
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('coupons', { keyPath: 'id' });
        db.createObjectStore('loyalty', { keyPath: 'id' });
        db.createObjectStore('meta');
      };
      r.onsuccess = () => {
        const db = r.result;
        db.onversionchange = () => { db.close(); dbp = null; };
        resolve(db);
      };
      r.onerror = () => { dbp = null; reject(r.error); };
      r.onblocked = () => { dbp = null; reject(new Error('IndexedDB blocked')); };
    });
    return dbp;
  }

  // work(tx, setResult): 트랜잭션이 완료(커밋)된 뒤에야 resolve → 저장 성공이 보장된 시점에만 true
  async function run(stores, mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
      work(t, v => { result = v; });
    });
  }

  const loadAll = () => run(['coupons', 'loyalty', 'meta'], 'readonly', (t, out) => {
    const res = { coupons: [], loyalty: [], meta: { lastNotify: '', lastBackup: '' } };
    const c = t.objectStore('coupons').getAll(); c.onsuccess = () => { res.coupons = c.result; };
    const l = t.objectStore('loyalty').getAll(); l.onsuccess = () => { res.loyalty = l.result; };
    const n = t.objectStore('meta').get('lastNotify'); n.onsuccess = () => { res.meta.lastNotify = n.result || ''; };
    const b = t.objectStore('meta').get('lastBackup'); b.onsuccess = () => { res.meta.lastBackup = b.result || ''; };
    out(res);
  });

  const put = (store, obj) => run([store], 'readwrite', t => { t.objectStore(store).put(obj); });
  const remove = (store, id) => run([store], 'readwrite', t => { t.objectStore(store).delete(id); });
  const clearAll = () => run(['coupons', 'loyalty'], 'readwrite', t => { t.objectStore('coupons').clear(); t.objectStore('loyalty').clear(); });
  // 쿠폰·적립 변경을 한 트랜잭션으로 묶음: 전부 성공하거나 전부 취소(중간 상태가 남지 않음)
  const batch = ({ putCoupons = [], putLoyalty = [], delCoupons = [], delLoyalty = [] }) =>
    run(['coupons', 'loyalty'], 'readwrite', t => {
      const c = t.objectStore('coupons'), l = t.objectStore('loyalty');
      delCoupons.forEach(id => c.delete(id)); delLoyalty.forEach(id => l.delete(id));
      putCoupons.forEach(o => c.put(o)); putLoyalty.forEach(o => l.put(o));
    });
  const setMeta = (k, v) => run(['meta'], 'readwrite', t => { t.objectStore('meta').put(v, k); });
  const getMeta = k => run(['meta'], 'readonly', (t, out) => { const r = t.objectStore('meta').get(k); r.onsuccess = () => out(r.result); });

  // 하루 1회, 임박 항목이 있을 때만 알림. 화면과 백그라운드(periodicsync)가 같이 호출해도 tag로 합쳐짐
  async function checkAndNotify(reg) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
    const data = await loadAll();
    const t = root.CW.today();
    if (data.meta.lastNotify === t) return false;
    const lines = root.CW.notifyLines(data, t);
    if (!lines.length) return false;
    const body = lines.slice(0, 5).join('\n') + (lines.length > 5 ? `\n외 ${lines.length - 5}건` : '');
    await reg.showNotification('쿠폰 지갑', { body, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'daily' });
    await setMeta('lastNotify', t);
    return true;
  }

  root.CWStore = { open, loadAll, put, remove, batch, clearAll, setMeta, getMeta, checkAndNotify };
})(typeof self !== 'undefined' ? self : this);
