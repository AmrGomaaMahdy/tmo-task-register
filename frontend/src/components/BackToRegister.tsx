import { useNavigate } from 'react-router-dom';

const KEY = 'task-register.register-url';

/** The Task Register page records its address (view and filters) so the way back returns to it. */
export function rememberRegister(url: string) {
  try {
    sessionStorage.setItem(KEY, url);
  } catch {
    /* private window: the way back opens the register's first view */
  }
}

/** Back to the Task Register list, as the user left it. Shown on a task's page and in the task form. */
export default function BackToRegister({ label = 'Task Register' }: { label?: string }) {
  const navigate = useNavigate();
  const go = () => {
    let url = '/register';
    try {
      url = sessionStorage.getItem(KEY) || url;
    } catch {
      /* keep the default */
    }
    navigate(url);
  };
  return (
    <button type="button" className="back-link" onClick={go}>
      <span aria-hidden="true">←</span> Back to {label}
    </button>
  );
}
