import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isServerReachable, setIsServerReachable] = useState(true);

  // Check current session on mount
  const checkAuth = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getMe();
      setUser(data.user);
      setIsServerReachable(true);
    } catch (err) {
      if (err.code === 'NETWORK_ERROR') {
        setIsServerReachable(false);
      } else {
        setIsServerReachable(true);
      }
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkAuth();

    // Listen for unauthorized events emitted by API client
    const handleUnauthorized = () => {
      setUser(null);
    };

    window.addEventListener('pulsewatch:unauthorized', handleUnauthorized);
    return () => {
      window.removeEventListener('pulsewatch:unauthorized', handleUnauthorized);
    };
  }, [checkAuth]);

  const login = async (email, password) => {
    const data = await api.login(email, password);
    setUser(data.user);
    setIsServerReachable(true);
    return data.user;
  };

  const register = async (email, password) => {
    const data = await api.register(email, password);
    setUser(data.user);
    setIsServerReachable(true);
    return data.user;
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch (err) {
      console.warn('Logout request warning:', err.message);
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: !!user,
        isServerReachable,
        setIsServerReachable,
        checkAuth,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
