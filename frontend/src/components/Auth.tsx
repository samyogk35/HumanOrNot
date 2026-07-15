import { useState } from 'react';

interface AuthProps {
  onTokenReceived: (token: string) => void;
}

function Auth({ onTokenReceived }: AuthProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const submit = async (endpoint: '/login' | '/signup') => {
    setError('');
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        setError('Authentication failed');
        return;
      }

      const data = await res.json();
      onTokenReceived(data.token);
    } catch {
      setError('Network error');
    }
  };

  return (
    <div className="auth-container">
      <input
        className="brutal-input"
        type="text"
        placeholder="Username"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
      />
      <input
        className="brutal-input"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />

      <button className="brutal-button" onClick={() => submit('/login')}>
        Login
      </button>
      <button className="brutal-button" onClick={() => submit('/signup')}>
        Signup
      </button>

      {error && <p className="auth-error">{error}</p>}
    </div>
  );
}

export default Auth;
