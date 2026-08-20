import { coordinatorTeam } from '../../pages/DashboardPage/dashboard-data';
import { StatusPill } from '../StatusPill/StatusPill';

export function TeamOverview() {
  return (
    <section className="panel team-panel" id="section-01">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">Equipo asignado · turno mañana</p>
          <h2>Personas en operación</h2>
        </div>
        <button className="quiet-button" type="button">Gestionar equipo <span aria-hidden="true">↗</span></button>
      </header>

      <div className="team-table" role="table" aria-label="Equipo asignado">
        <div className="team-table__head" role="row">
          <span>Persona</span><span>Estado</span><span>Perfiles</span><span>Turno</span><span aria-hidden="true" />
        </div>
        {coordinatorTeam.map((member) => (
          <div className="team-table__row" role="row" key={member.name}>
            <div className="team-member" role="cell"><span className="profile-avatar profile-avatar--small">{member.initials}</span><span><strong>{member.name}</strong><small>{member.role}</small></span></div>
            <span role="cell"><StatusPill status={member.status} /></span>
            <span className="team-muted" role="cell">{member.profiles}</span>
            <span className="team-muted" role="cell">{member.shift}</span>
            <button className="row-more" type="button" aria-label={`Ver a ${member.name}`}>•••</button>
          </div>
        ))}
      </div>
    </section>
  );
}
