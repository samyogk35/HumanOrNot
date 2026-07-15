import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Auth from './Auth'; // Claude needs to implement this

// Mock the global fetch for testing
global.fetch = vi.fn();

describe('Frontend Phase 1: Auth Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render the username/password inputs and brutalist buttons', () => {
    render(<Auth onTokenReceived={() => {}} />);
    
    // Inputs must have the brutal-input class from index.css
    const usernameInput = screen.getByPlaceholderText(/username/i);
    const passwordInput = screen.getByPlaceholderText(/password/i);
    
    expect(usernameInput).toBeInTheDocument();
    expect(usernameInput).toHaveClass('brutal-input');
    
    expect(passwordInput).toBeInTheDocument();
    expect(passwordInput).toHaveClass('brutal-input');
    
    // Buttons must have the brutal-button class
    const loginBtn = screen.getByRole('button', { name: /login/i });
    const signupBtn = screen.getByRole('button', { name: /signup/i });
    
    expect(loginBtn).toHaveClass('brutal-button');
    expect(signupBtn).toHaveClass('brutal-button');
  });

  it('should call /login with credentials and return a token', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ token: 'mock-jwt-token' })
    } as any);

    const onTokenReceived = vi.fn();
    render(<Auth onTokenReceived={onTokenReceived} />);

    fireEvent.change(screen.getByPlaceholderText(/username/i), { target: { value: 'neo' } });
    fireEvent.change(screen.getByPlaceholderText(/password/i), { target: { value: 'pw123' } });
    
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/login', expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'neo', password: 'pw123' })
      }));
      expect(onTokenReceived).toHaveBeenCalledWith('mock-jwt-token');
    });
  });
});
