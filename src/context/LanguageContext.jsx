import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  normalizeLang,
  readStoredLanguage,
  translate,
  writeStoredLanguage,
} from '@/lib/i18n';
import { useAuth } from '@/hooks/useAuth';
import pb from '@/lib/pocketbaseClient';

const LanguageContext = createContext(null);

export function LanguageProvider({ children }) {
  const { user } = useAuth();
  const [language, setLanguageState] = useState(() => readStoredLanguage());

  const setLanguage = useCallback((lang) => {
    const next = writeStoredLanguage(lang);
    setLanguageState(next);
    return next;
  }, []);

  useEffect(() => {
    writeStoredLanguage(language);
  }, [language]);

  // Sync from PocketBase profile when available
  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    pb.collection('users').getOne(user.id)
      .then((profile) => {
        if (!active || !profile?.language) return;
        const next = normalizeLang(profile.language);
        if (next !== readStoredLanguage()) {
          setLanguage(next);
        } else {
          setLanguageState(next);
        }
      })
      .catch(() => {});
    return () => { active = false; };
  }, [user?.id, setLanguage]);

  const t = useCallback(
    (key, vars) => translate(language, key, vars),
    [language],
  );

  const value = useMemo(
    () => ({ language, setLanguage, t }),
    [language, setLanguage, t],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    const lang = readStoredLanguage();
    return {
      language: lang,
      setLanguage: writeStoredLanguage,
      t: (key, vars) => translate(lang, key, vars),
    };
  }
  return ctx;
}
