import { useEffect, useState } from 'react';
import { managedDeviceSchema, readinessResponseSchema, type ManagedDevice, type ReadinessResponse, type UserSummary } from '@agency-os/shared';
import { ApiError, apiClient } from '../../services/api-client';
import { canManage, errorMessage } from '../OperationsManagement/management-view';
import { formatSecurityDate, isDeviceOnline } from './security-view';

interface SecurityOverviewProps {
  accessToken: string | null;
  user: UserSummary;
}

function deviceStatusLabel(status: ManagedDevice['status']): string {
  return status === 'APPROVED' ? 'Aprobado' : status === 'PENDING' ? 'Pendiente' : 'Revocado';
}

function deviceStatusClass(status: ManagedDevice['status']): string {
  return status === 'APPROVED' ? 'is-approved' : status === 'PENDING' ? 'is-pending' : 'is-revoked';
}

function deviceKindLabel(kind: ManagedDevice['deviceKind']): string {
  return kind === 'ADMIN' ? 'Administrativo' : 'Estación';
}

function shortFingerprint(fingerprint: string | null): string {
  return fingerprint ? `${fingerprint.slice(0, 12)}…${fingerprint.slice(-6)}` : 'Sin certificado';
}

async function readPublicReadiness(): Promise<unknown> {
  const configured = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:3000/api/v1';
  const apiOrigin = configured.replace(/\/api\/v1\/?$/, '');
  const response = await fetch(`${apiOrigin}/health/ready`, { credentials: 'include' });
  if (!response.ok) throw new Error('No pudimos comprobar el estado del backend.');
  return response.json() as Promise<unknown>;
}

export function SecurityOverview({ accessToken, user }: SecurityOverviewProps) {
  const [readiness, setReadiness] = useState<ReadinessResponse | null>(null);
  const [devices, setDevices] = useState<ManagedDevice[]>([]);
  const [confirmingRevokeId, setConfirmingRevokeId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [busyDeviceId, setBusyDeviceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canManageDevices = canManage(user.permissions, 'devices.manage');

  useEffect(() => {
    if (!accessToken) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    const deviceRequest = canManageDevices ? apiClient.request<unknown>('/devices') : Promise.resolve([]);
    Promise.all([readPublicReadiness(), deviceRequest])
      .then(([rawReadiness, rawDevices]) => {
        if (cancelled) return;
        setReadiness(readinessResponseSchema.parse(rawReadiness));
        setDevices(managedDeviceSchema.array().parse(rawDevices));
      })
      .catch((nextError) => {
        if (!cancelled) setError(nextError instanceof ApiError ? nextError.message : 'No pudimos cargar el estado de seguridad.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [accessToken, canManageDevices]);

  async function revokeDevice(device: ManagedDevice) {
    setBusyDeviceId(device.id);
    setError(null);
    setNotice(null);
    try {
      await apiClient.request(`/devices/${device.id}/revoke`, { method: 'POST', body: JSON.stringify({ reason: 'ADMIN_REVOKE' }) });
      setNotice(`${device.label} quedó revocado. Su certificado ya no autoriza ninguna operación.`);
      setConfirmingRevokeId(null);
      setDevices((current) => current.map((item) => item.id === device.id ? { ...item, status: 'REVOKED', revokedAt: new Date().toISOString(), revokedReason: 'ADMIN_REVOKE' } : item));
    } catch (nextError) {
      setError(nextError instanceof ApiError ? nextError.message : errorMessage(nextError, 'No pudimos revocar el dispositivo.'));
    } finally {
      setBusyDeviceId(null);
    }
  }

  const checks = readiness ? Object.entries(readiness.checks) : [];
  const approvedCount = devices.filter((device) => device.status === 'APPROVED').length;
  const onlineCount = devices.filter((device) => device.status === 'APPROVED' && isDeviceOnline(device.lastSeenAt)).length;

  return (
    <section className="panel security-panel motion-safe:timeline-view motion-safe:animate-fade-in-up motion-safe:animate-range-[entry_0%_contain_20%]" id="security-overview" aria-labelledby="security-overview-title">
      <header className="panel-header">
        <div><p className="panel-kicker">Perímetro y estaciones</p><h2 id="security-overview-title">Estado de seguridad</h2></div>
        {readiness && <span className={`security-badge ${readiness.status === 'ok' ? 'security-badge--good' : 'security-badge--warning'}`}>{readiness.status === 'ok' ? 'Sistema listo' : 'Revisar estado'}</span>}
      </header>
      <p className="management-panel__note">Salud de dependencias y equipos autorizados. La identidad de cada equipo es el certificado mTLS emitido para esa PC; aquí solo se registra su huella, nunca una clave.</p>
      {error && <p className="form-notice form-notice--error" role="alert">{error}</p>}
      {notice && <p className="form-notice" role="status">{notice}</p>}
      {isLoading && <p className="panel-state">Comprobando perímetro y estaciones…</p>}
      {!isLoading && <>
        <div className="security-summary-grid">
          <div><span>Dependencias</span><strong>{checks.length ? `${checks.filter(([, ok]) => ok).length}/${checks.length}` : '—'}</strong><small>servicios listos</small></div>
          <div><span>Estaciones aprobadas</span><strong>{approvedCount.toString().padStart(2, '0')}</strong><small>{onlineCount} con señal reciente</small></div>
          <div><span>Regla operativa</span><strong>mTLS</strong><small>Certificado verificado por equipo</small></div>
        </div>
        <div className="security-checks" aria-label="Comprobaciones de salud">
          {checks.map(([name, ok]) => <span className={ok ? 'security-check is-ok' : 'security-check is-warning'} key={name}><i aria-hidden="true" />{name}: {ok ? 'listo' : 'revisar'}</span>)}
        </div>
        {canManageDevices && <>
          <div className="security-section-heading"><div><p className="panel-kicker">Control de estaciones</p><h3>Dispositivos enrolados</h3></div><span className="management-muted">Señal reciente: 15 min</span></div>
          {!devices.length && <p className="panel-state">Todavía no hay estaciones enroladas.</p>}
          {devices.length > 0 && <div className="security-table security-table--devices" role="table" aria-label="Dispositivos enrolados">
            <div className="security-table__head" role="row"><span>Estación</span><span>Tipo</span><span>Estado</span><span>Certificado</span><span>Última señal</span><span>Acciones</span></div>
            {devices.map((device) => {
              const isBusy = busyDeviceId === device.id;
              const isConfirming = confirmingRevokeId === device.id;
              return <div className="security-table__row" role="row" key={device.id}>
                <div role="cell"><strong>{device.label}</strong><small>{device.hostname} · ext {device.extensionVersion ?? '—'} · helper {device.helperVersion ?? '—'}</small></div>
                <span className="management-muted" role="cell">{deviceKindLabel(device.deviceKind)}</span>
                <span className={`security-device-status ${deviceStatusClass(device.status)}`} role="cell">{deviceStatusLabel(device.status)}</span>
                <div role="cell"><strong>{shortFingerprint(device.certFingerprint)}</strong><small>{device.certNotAfter ? `Vence ${formatSecurityDate(device.certNotAfter)}` : 'Sin vencimiento registrado'}</small></div>
                <div role="cell"><strong>{device.lastSeenAt ? formatSecurityDate(device.lastSeenAt) : 'Nunca'}</strong><small>{isDeviceOnline(device.lastSeenAt) ? 'Conectado ahora' : 'Sin señal reciente'}</small></div>
                <div className="management-actions" role="cell">
                  {device.status !== 'REVOKED' && !isConfirming && <button className="row-action row-action--danger" type="button" onClick={() => setConfirmingRevokeId(device.id)}>Revocar</button>}
                  {isConfirming && <><button className="row-action row-action--danger" type="button" onClick={() => void revokeDevice(device)} disabled={isBusy}>{isBusy ? '…' : 'Confirmar revocación'}</button><button className="row-action" type="button" onClick={() => setConfirmingRevokeId(null)} disabled={isBusy}>Cancelar</button></>}
                </div>
              </div>;
            })}
          </div>}
        </>}
      </>}
    </section>
  );
}
