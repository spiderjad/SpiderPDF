// Iconos de tipo de archivo para exportar: hoja con la esquina doblada y una pastilla con la letra, en el color
// que todo el mundo asocia con Word (azul) y Excel (verde). Dibujo propio: no son los logotipos de Microsoft.

function Badge({ size, letter, from, to, label }) {
  const id = `badge-${letter}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'} className="shrink-0">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={from} />
          <stop offset="1" stopColor={to} />
        </linearGradient>
      </defs>
      {/* Hoja */}
      <path d="M9 3h11l7 7v17a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" fill="#fff" stroke="#C4C4CA" strokeWidth="1" />
      <path d="M20 3v5a2 2 0 0 0 2 2h5" fill="#E7E7E9" stroke="#C4C4CA" strokeWidth="1" strokeLinejoin="round" />
      <path d="M15 15h8M15 19h8M15 23h6" stroke={to} strokeOpacity=".35" strokeWidth="1.5" strokeLinecap="round" />
      {/* Pastilla con la letra */}
      <rect x="2" y="11" width="15" height="15" rx="3.5" fill={`url(#${id})`} />
      <text x="9.5" y="22.3" textAnchor="middle" fontFamily="Inter Variable, Inter, system-ui, sans-serif" fontWeight="700" fontSize="10.5" fill="#fff">{letter}</text>
    </svg>
  );
}

export const WordBadge = ({ size = 20, label }) => <Badge size={size} letter="W" from="#2B7CD3" to="#185ABD" label={label} />;
export const ExcelBadge = ({ size = 20, label }) => <Badge size={size} letter="X" from="#21A366" to="#107C41" label={label} />;
