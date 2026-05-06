import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';

import App from '@/App.jsx';
import { AuthProvider } from '@/contexts/AuthContext.jsx';
import i18n from '@/i18n/index.js';

function renderApp(initialPath = '/login') {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter initialEntries={[initialPath]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>
    </I18nextProvider>
  );
}

describe('App smoke test', () => {
  it('renders the login route without crashing', () => {
    renderApp('/login');
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });

  it('renders the 403 route', () => {
    renderApp('/403');
    expect(screen.getByText('403')).toBeInTheDocument();
  });
});
