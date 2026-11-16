import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="panel"><div className="panel-bd">
      <h2>Page not found</h2>
      <p>The page you asked for does not exist. <Link to="/">Go to the overview</Link>.</p>
    </div></div>
  );
}
