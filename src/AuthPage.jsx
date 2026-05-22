import React, { useState } from 'react';
import { User, Lock, Mail, ChevronRight, LogIn, UserPlus } from 'lucide-react';

export default function AuthPage({ onLogin }) {
  const [isLogin, setIsLogin] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const url = isLogin ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');
      
      localStorage.setItem('auth_token', data.token);
      onLogin(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] p-4">
      <div className="card w-full max-w-md p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-600"></div>
        
        <div className="text-center mb-8">
          <div className="mx-auto w-16 h-16 bg-[#161b22] border border-[#30363d] rounded-2xl flex items-center justify-center mb-4 shadow-lg">
            {isLogin ? <LogIn className="text-blue-500" size={32} /> : <UserPlus className="text-purple-500" size={32} />}
          </div>
          <h2 className="text-2xl font-bold text-[#e6edf3]">
            {isLogin ? 'Welcome Back' : 'Create Account'}
          </h2>
          <p className="text-sm text-[#8b949e] mt-2">
            {isLogin ? 'Login to access your Paper Trading dashboard' : 'Join to start practicing with virtual capital'}
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm text-center">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#8b949e] mb-1.5 uppercase tracking-wider">Username</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b949e]" size={16} />
              <input 
                type="text" 
                required
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg py-2.5 pl-10 pr-4 text-[#e6edf3] focus:border-blue-500 focus:outline-none transition-colors"
                placeholder="johndoe"
                value={username}
                onChange={e => setUsername(e.target.value)}
              />
            </div>
          </div>
          
          <div>
            <label className="block text-xs font-semibold text-[#8b949e] mb-1.5 uppercase tracking-wider">Password</label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8b949e]" size={16} />
              <input 
                type="password" 
                required
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-lg py-2.5 pl-10 pr-4 text-[#e6edf3] focus:border-blue-500 focus:outline-none transition-colors"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </div>
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full py-3 mt-6 bg-[#238636] hover:bg-[#2ea043] text-white rounded-lg font-semibold transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Create Account')}
            {!loading && <ChevronRight size={18} />}
          </button>
        </form>

        <div className="mt-8 text-center border-t border-[#30363d] pt-6">
          <p className="text-sm text-[#8b949e]">
            {isLogin ? "Don't have an account?" : "Already have an account?"}
            <button 
              onClick={() => setIsLogin(!isLogin)} 
              className="ml-2 text-blue-400 hover:text-blue-300 font-semibold hover:underline"
            >
              {isLogin ? 'Sign Up' : 'Log In'}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}
