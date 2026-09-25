export interface ProfileSummary {
  id: string;
  name: string;
  handle: string;
  status: 'active' | 'available' | 'handoff';
  lastActivity: string;
  initials: string;
}

export const operatorProfiles: ProfileSummary[] = [
  {
    id: 'aurora-01',
    name: 'Aurora N.',
    handle: '@aurora.north',
    status: 'active',
    lastActivity: 'Sesión activa · hace 4 min',
    initials: 'AN',
  },
  {
    id: 'marea-07',
    name: 'Marea 07',
    handle: '@marea.seven',
    status: 'available',
    lastActivity: 'Disponible para abrir',
    initials: 'M7',
  },
  {
    id: 'sol-12',
    name: 'Sol de Abril',
    handle: '@sol.abril',
    status: 'active',
    lastActivity: 'Sesión activa · hace 11 min',
    initials: 'SA',
  },
  {
    id: 'nube-03',
    name: 'Nube 03',
    handle: '@nube.three',
    status: 'handoff',
    lastActivity: 'Relevo a las 14:05',
    initials: 'N3',
  },
];

export interface TeamMember {
  name: string;
  role: string;
  status: 'online' | 'break' | 'offline';
  profiles: string;
  shift: string;
  initials: string;
}

export const coordinatorTeam: TeamMember[] = [
  { name: 'Valentina Ríos', role: 'Operadora', status: 'online', profiles: '4 perfiles', shift: '06:05 — 14:05', initials: 'VR' },
  { name: 'Camila Torres', role: 'Operadora', status: 'online', profiles: '3 perfiles', shift: '06:05 — 14:05', initials: 'CT' },
  { name: 'Sofía Méndez', role: 'Operadora', status: 'break', profiles: '4 perfiles', shift: '14:05 — 22:05', initials: 'SM' },
  { name: 'Lucía Pardo', role: 'Operadora', status: 'offline', profiles: '2 perfiles', shift: '22:05 — 06:05', initials: 'LP' },
];

export const managementMetrics = [
  { label: 'Perfiles activos', value: '42', detail: '+8.4% vs. semana anterior', direction: 'up' as const, accent: 'blue' as const },
  { label: 'Operadores en turno', value: '18 / 21', detail: '85% de cobertura actual', direction: 'steady' as const, accent: 'navy' as const },
  { label: 'Revenue del día', value: '$4.82M', detail: '+12.1% vs. promedio', direction: 'up' as const, accent: 'orange' as const },
  { label: 'Respuesta de icebreakers', value: '3.8%', detail: 'Por encima de la meta de 2%', direction: 'up' as const, accent: 'blue' as const },
];

export const cafeteriaMenu = [
  { name: 'Tinto campesino', category: 'Bebidas calientes', price: '$3.500', sold: 34, available: true },
  { name: 'Arepa de queso', category: 'Desayunos', price: '$6.000', sold: 22, available: true },
  { name: 'Jugo de mango', category: 'Bebidas frías', price: '$5.000', sold: 18, available: true },
  { name: 'Almuerzo del día', category: 'Platos fuertes', price: '$16.000', sold: 12, available: false },
];

export const cafeteriaSales = [
  { label: 'Ventas del día', value: '$428.500', detail: '86 transacciones', accent: 'orange' as const },
  { label: 'Ticket promedio', value: '$4.982', detail: '+$420 vs. ayer', accent: 'blue' as const },
  { label: 'Productos vendidos', value: '112', detail: '74% del objetivo diario', accent: 'navy' as const },
];

export const activityFeed = [
  { time: '09:42', label: 'Operador conectado', detail: 'Valentina Ríos inició turno', tone: 'blue' },
  { time: '09:18', label: 'Relevo confirmado', detail: 'Perfil Nube 03 · 14:05', tone: 'orange' },
  { time: '08:55', label: 'Datos sincronizados', detail: 'Revenue detailed · Tableau', tone: 'navy' },
];
