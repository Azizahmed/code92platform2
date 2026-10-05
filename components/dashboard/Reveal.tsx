type Props = {
  index?: number;
  className?: string;
  children: React.ReactNode;
};

// CSS handles the reveal without a client boundary, one animation-frame
// callback and a state update for every product card.
export default function Reveal({index = 0, className = '', children}: Props) {
  return (
    <div
      className={`${className} dashboard-reveal`}
      style={{animationDelay: `${Math.min(index, 12) * 60}ms`}}
    >
      {children}
    </div>
  );
}
