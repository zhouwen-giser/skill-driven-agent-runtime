import { useEffect, useState } from 'react';
import { managementRequest } from './api.js';

interface DemoView {
  deviceExecution: string;
  disabledReason: string;
  records: {
    requestId: string;
    objectId: string;
    state: string;
    phase: string;
    observedAt: string;
  }[];
}

export function IsolatedDemoPanel() {
  const [view, setView] = useState<DemoView>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const [pending, setPending] = useState<string>();
  useEffect(() => {
    void managementRequest<DemoView>('/api/v1/development/isolated-demo')
      .then(setView)
      .catch(() => {
        setError('此实例未开放隔离软件演示。');
      });
  }, []);
  async function submit(confirm: boolean) {
    setBusy(true);
    setError('');
    try {
      const requestId = confirm ? pending : crypto.randomUUID();
      if (!requestId || (confirm && !ack)) return;
      const result = await managementRequest<DemoView>(
        `/api/v1/development/isolated-demo/${confirm ? 'confirm' : 'requests'}`,
        {
          method: 'POST',
          body: JSON.stringify(
            confirm
              ? { requestId, acknowledgement: 'software-only' }
              : { requestId, objectId: 'demo:indicator', state: 'active' },
          ),
        },
      );
      setView(result);
      setPending(confirm ? undefined : requestId);
      setAck(false);
    } catch {
      setError('软件演示请求未完成；未调用设备。可读取审计确认状态。');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>武器/效应器：Device 执行禁用</h2>
      <p>
        登记参考：ugv.fire-weapon / vehicle.ugv.fire-weapon。此页面不是可执行的 Device Capability。
      </p>
      <p>禁用原因：{view?.disabledReason ?? 'DEVICE_EFFECTOR_EXECUTION_NOT_IMPLEMENTED'}</p>
      <h3>隔离软件状态演示</h3>
      <p>
        仅将 demo:indicator 的软件标记设为 active；没有目标、弹药、发射指令、MCP、MQTT
        或硬件适配器。不生成真实 Mission、设备执行或物理成功证据。
      </p>
      <button disabled={busy || !view || !!pending} onClick={() => void submit(false)}>
        准备软件演示（不执行）
      </button>
      {pending && (
        <div>
          <label>
            <input
              type="checkbox"
              checked={ack}
              onChange={(event) => {
                setAck(event.target.checked);
              }}
            />
            我人工确认：仅修改隔离软件状态，不授权 Device 执行。
          </label>
          <button disabled={busy || !ack} onClick={() => void submit(true)}>
            确认一次软件演示
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      <h3>持久审计</h3>
      <ul>
        {view?.records.map((row) => (
          <li key={`${row.requestId}:${row.phase}`}>
            {row.requestId} · {row.phase} · {row.objectId}={row.state} · {row.observedAt} ·
            software-only
          </li>
        ))}
      </ul>
    </section>
  );
}
