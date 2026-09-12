import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { useAuth } from '@/hooks/useAuth';
import SplashScreen from '@/components/SplashScreen';
import { dismissBootSplash } from '@/lib/bootSplash';

const TIMING = {
  splash: 1500,
  transition: 500,
  reveal: 1500,
  exit: 350,
};

/**
 * Opening sequence on every full app load (~3.85s total).
 * Auth/session resolves in parallel; routes appear only after both finish.
 */
export default function StartupGate({ children }) {
  const { loading } = useAuth();
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState('splash');
  const [sequenceComplete, setSequenceComplete] = useState(false);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    dismissBootSplash();
  }, []);

  useEffect(() => {
    if (!loading) setAuthReady(true);
  }, [loading]);

  useEffect(() => {
    const splashMs = reduceMotion ? 800 : TIMING.splash;
    const transitionMs = reduceMotion ? 0 : TIMING.transition;
    const revealMs = reduceMotion ? 700 : TIMING.reveal;
    const exitMs = reduceMotion ? 0 : TIMING.exit;
    const total = splashMs + transitionMs + revealMs + exitMs;

    const timers = [
      window.setTimeout(() => setPhase('transition'), splashMs),
      window.setTimeout(() => setPhase('reveal'), splashMs + transitionMs),
      window.setTimeout(() => setPhase('exit'), splashMs + transitionMs + revealMs),
      window.setTimeout(() => setSequenceComplete(true), total),
    ];

    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [reduceMotion]);

  if (sequenceComplete && authReady) return children;

  const displayPhase = sequenceComplete && !authReady ? 'reveal' : phase;

  return <SplashScreen phase={displayPhase} />;
}
