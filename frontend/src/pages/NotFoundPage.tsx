import { Link } from 'react-router-dom';

import { Blocked } from '../components/ui';

export default function NotFoundPage() {
  return (
    <Blocked title="Page not found" actions={<Link className="btn pri" to="/">Go to the overview</Link>}>
      This address does not match a page of the register. Check the link, or start again from the overview.
    </Blocked>
  );
}
