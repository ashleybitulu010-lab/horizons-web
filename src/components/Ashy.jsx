import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const IDLE_IMG = 'https://images.hostinger.com/7c11ca1e-8e03-42f9-9349-18d02a30105e.png';
const WAVE_IMG = 'https://images.hostinger.com/af76e467-6356-4216-97c0-3ed0199104b9.png';
const CELEBRATE_IMG = 'https://images.hostinger.com/8cbed177-d716-4b66-873e-a42c4d254a23.png';

const STATES = {
  IDLE: 'idle',
  WAVE: 'wave',
  CELEBRATE: 'celebrate',
  THINKING: 'thinking',
  TOUCHED: 'touched',
  INACTIVITY: 'inactivity',
};

function getImg(state) {
  if (state === STATES.CELEBRATE || state === STATES.TOUCHED) return CELEBRATE_IMG;
  if (state === STATES.WAVE) return WAVE_IMG;
  return IDLE_IMG;
}

export default function Ashy({ size = 100, onOpenChat, celebrateSignal, thinkingSignal }) {
  const [state, setState] = useState(STATES.WAVE); // start with wave greeting
  const [floatY, setFloatY] = useState(0);
  const inactivityTimer = useRef(null);
  const frameRef = useRef(null);
  const startTime = useRef(Date.now());
  const stateRef = useRef(state);

  stateRef.current = state;

  // Floating animation via rAF
  useEffect(() => {
    const animate = () => {
      const t = (Date.now() - startTime.current) / 1000;
      setFloatY(Math.sin(t * 1.4) * 5);
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, []);

  // Initial greeting wave then return to idle
  useEffect(() => {
    const t = setTimeout(() => setState(STATES.IDLE), 2500);
    return () => clearTimeout(t);
  }, []);

  // Celebrate on message send signal
  useEffect(() => {
    if (!celebrateSignal) return;
    setState(STATES.CELEBRATE);
    const t = setTimeout(() => setState(STATES.IDLE), 2000);
    return () => clearTimeout(t);
  }, [celebrateSignal]);

  // Thinking on signal
  useEffect(() => {
    if (thinkingSignal === undefined) return;
    if (thinkingSignal) {
      setState(STATES.THINKING);
    } else {
      setState(STATES.IDLE);
    }
  }, [thinkingSignal]);

  // Inactivity: yawn/stretch after 25s idle
  const resetInactivity = () => {
    clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => {
      if (stateRef.current === STATES.IDLE) {
        setState(STATES.INACTIVITY);
        setTimeout(() => setState(STATES.IDLE), 2800);
      }
    }, 25000);
  };

  useEffect(() => {
    resetInactivity();
    window.addEventListener('mousemove', resetInactivity);
    window.addEventListener('keydown', resetInactivity);
    return () => {
      clearTimeout(inactivityTimer.current);
      window.removeEventListener('mousemove', resetInactivity);
      window.removeEventListener('keydown', resetInactivity);
    };
  }, []);

  // Periodic wave when idle
  useEffect(() => {
    const cycle = () => {
      const delay = 10000 + Math.random() * 8000;
      return setTimeout(() => {
        if (stateRef.current === STATES.IDLE) {
          setState(STATES.WAVE);
          setTimeout(() => setState(STATES.IDLE), 2200);
        }
        timerRef.current = cycle();
      }, delay);
    };
    const timerRef = { current: cycle() };
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleClick = () => {
    setState(STATES.TOUCHED);
    setTimeout(() => {
      setState(STATES.IDLE);
      onOpenChat?.();
    }, 400);
  };

  // Animation variants per state
  const stateAnims = {
    [STATES.IDLE]: {},
    [STATES.WAVE]: { rotate: [0, -8, 8, -6, 6, 0], transition: { duration: 0.7, ease: 'easeInOut' } },
    [STATES.CELEBRATE]: { scale: [1, 1.15, 1.08, 1.12, 1], rotate: [0, -5, 5, -3, 0], transition: { duration: 0.6 } },
    [STATES.THINKING]: { rotate: [0, 6, 6], x: [0, 3, 3], transition: { duration: 0.5 } },
    [STATES.TOUCHED]: { scale: [1, 1.18, 0.95, 1.05, 1], rotate: [0, -8, 8, 0], transition: { duration: 0.45 } },
    [STATES.INACTIVITY]: { rotate: [0, 3, -3, 3, 0], scale: [1, 0.97, 1], transition: { duration: 1.2 } },
  };

  const currentAnim = stateAnims[state] || {};

  return (
    <motion.div
      onClick={handleClick}
      animate={{ ...currentAnim, y: floatY }}
      style={{
        width: size,
        height: size,
        background: 'transparent',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <AnimatePresence mode="wait">
        <motion.img
          key={state}
          src={getImg(state)}
          alt="Ashy"
          initial={{ opacity: 0.7, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0.6, scale: 0.96 }}
          transition={{ duration: 0.18 }}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            imageRendering: 'auto',
            userSelect: 'none',
            pointerEvents: 'none',
          }}
          draggable={false}
        />
      </AnimatePresence>

      {/* Particle burst on celebrate */}
      <AnimatePresence>
        {(state === STATES.CELEBRATE || state === STATES.TOUCHED) && (
          <>
            {[...Array(6)].map((_, i) => {
              const angle = (i / 6) * 360;
              const rad = (angle * Math.PI) / 180;
              return (
                <motion.span
                  key={`p-${i}`}
                  initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
                  animate={{
                    opacity: 0,
                    x: Math.cos(rad) * 28,
                    y: Math.sin(rad) * 28,
                    scale: 0.3,
                  }}
                  transition={{ duration: 0.55, ease: 'easeOut' }}
                  style={{
                    position: 'absolute',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: i % 2 === 0 ? '#FF6B00' : '#FFF',
                    pointerEvents: 'none',
                  }}
                />
              );
            })}
          </>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
