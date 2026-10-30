/** Runtime-owned draft bindings. Application adapters never implement postMessage. */
export const EXPERIMENTAL_PRELUDE = `(() => {
  const pending = new Map();
  window.addEventListener('message', event => {
    if (event.source !== window.parent) return;
    const m = event.data;
    if (m?.type === 'llm.delta') {
      const p = pending.get(m.requestId);
      if (!p || p.type !== 'llm.generate' || typeof m.text !== 'string' || m.sequence !== p.sequence) return;
      p.sequence++;
      try { p.delta?.(m.text); } catch {}
      return;
    }
    const p = pending.get(m?.id);
    if (!p || m.type !== p.type + '.result') return;
    pending.delete(m.id); p.clean?.();
    if (m.error) p.reject(Object.assign(new Error(typeof m.error === 'string' ? m.error : m.error.message), {code:m.error.code}));
    else p.resolve(m[p.field]);
  });
  const call = (type, payload, field, options = {}) => new Promise((resolve, reject) => {
    if (options.signal?.aborted) { reject(Object.assign(new Error('Inference cancelled.'), {code:'cancelled'})); return; }
    const id = crypto.randomUUID();
    const abort = () => {
      pending.delete(id); options.signal?.removeEventListener('abort', abort);
      reject(Object.assign(new Error('Inference cancelled.'), {code:'cancelled'}));
      void call('llm.cancel', {requestId:id}, 'cancelled').catch(() => {});
    };
    pending.set(id, {type, field, resolve, reject, delta:options.onDelta, sequence:0,
      clean:() => options.signal?.removeEventListener('abort', abort)});
    options.signal?.addEventListener('abort', abort, {once:true});
    window.parent.postMessage({type,id,...payload}, '*');
  });
  window.napplet.llm = Object.freeze({
    select: requirements => call('llm.select', {requirements}, 'model'),
    describe: handle => call('llm.describe', {handle}, 'model'),
    generate: (request, options) => call('llm.generate', {request}, 'result', options),
    cancel: requestId => call('llm.cancel', {requestId}, 'cancelled'),
  });

})();`;
