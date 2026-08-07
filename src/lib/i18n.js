const STORAGE_KEY = 'ash_language';

export const DICTS = {
  fr: {
    'nav.guide': 'Guide Ashy',
    'nav.dashboard': 'Tableau de bord',
    'nav.profile': 'Mon profil',
    'nav.subscription': 'Mon abonnement',
    'nav.reports': 'Mes rapports',
    'nav.settings': 'Paramètres',
    'nav.logout': 'Déconnexion',
    'nav.user': 'Utilisateur',
    'nav.avatarAlt': 'Photo de profil',

    'common.cancel': 'Annuler',
    'common.delete': 'Supprimer',
    'common.close': 'Fermer',
    'common.you': 'Vous',
    'common.saving': 'Enregistrement…',
    'common.retry': 'Réessayer',

    'msg.copy': 'Copier',
    'msg.reply': 'Répondre',
    'msg.forward': 'Transférer',
    'msg.select': 'Sélectionner',
    'msg.delete': 'Supprimer',
    'msg.yourMessage': 'Votre message',
    'msg.actions': 'Actions du message',
    'msg.closeMenu': 'Fermer le menu',
    'msg.copied': 'Message copié',
    'msg.copyFail': 'Impossible de copier',
    'msg.forwardCopied': 'Message copié pour transfert',
    'msg.forwardFail': 'Transfert impossible',
    'msg.deleted': 'Message supprimé',
    'msg.deletedPlural': 'Messages supprimés',
    'msg.selected': '{{count}} sélectionné',
    'msg.selectedPlural': '{{count}} sélectionnés',
    'msg.deselect': 'Désélectionner',
    'msg.cancelReply': 'Annuler la réponse',
    'msg.cancelSelect': 'Annuler la sélection',

    'settings.title': 'Paramètres',
    'settings.meta': 'Gérez vos paramètres Ash Ledger.',
    'settings.guideSection': 'Guide Ashy',
    'settings.relaunchGuide': 'Relancer le guide interactif',
    'settings.guideCompleted': 'Revoir les bases avec Ashy (produit → stock → vente…)',
    'settings.guideSkipped': 'Vous avez passé le guide — vous pouvez le reprendre ici',
    'settings.guideActive': 'Guide en cours — reprendre avec Ashy',
    'settings.guidePending': 'Découvrir Ash Ledger en moins de 5 minutes',
    'settings.guideOpened': 'Guide Ashy ouvert…',
    'settings.prefs': 'Préférences',
    'settings.notifications': 'Notifications',
    'settings.notificationsHint': 'Recevoir des alertes et mises à jour',
    'settings.language': 'Langue',
    'settings.languageHint': "Langue de l'interface",
    'settings.currency': 'Devise',
    'settings.currencyHint': 'Unique pour le tableau de bord, les tables et les rapports',
    'settings.savePrefs': 'Enregistrer les préférences',
    'settings.saved': 'Préférences enregistrées !',
    'settings.saveError': "Erreur lors de l'enregistrement.",
    'settings.currencyLoadError': 'Impossible de charger votre devise.',
    'settings.security': 'Sécurité',
    'settings.changePassword': 'Modifier le mot de passe',
    'settings.oldPassword': 'Ancien mot de passe',
    'settings.newPassword': 'Nouveau mot de passe',
    'settings.confirmPassword': 'Confirmer le mot de passe',
    'settings.changing': 'Modification…',
    'settings.passwordChanged': 'Mot de passe modifié avec succès !',
    'settings.oldPasswordRequired': 'Saisissez votre ancien mot de passe.',
    'settings.passwordTooShort': 'Le mot de passe doit contenir au moins 8 caractères.',
    'settings.passwordMismatch': 'Les mots de passe ne correspondent pas.',
    'settings.passwordError': 'Ancien mot de passe incorrect ou erreur.',
    'settings.danger': 'Zone de danger',
    'settings.deleteAccount': 'Supprimer mon compte',
    'settings.deleteHint': 'Action irréversible — toutes vos données seront perdues',
    'settings.deleteTitle': 'Supprimer mon compte',
    'settings.deleteIrreversible': 'Cette action est irréversible',
    'settings.deleteBody': 'Toutes vos données seront définitivement supprimées. Tapez {{word}} pour confirmer.',
    'settings.deleteConfirmWord': 'SUPPRIMER',
    'settings.deleting': 'Suppression…',
    'settings.deleteTypeError': 'Veuillez saisir "{{word}}" pour confirmer.',
    'settings.deleteError': 'Erreur lors de la suppression du compte.',

    'dashboard.title': 'Tableau de bord',
    'dashboard.overview': "Vue d'ensemble",
    'dashboard.unavailable': 'Données indisponibles',
    'dashboard.evolution': 'Évolution financière',
    'dashboard.noOps': 'Aucune opération sur cette période',
    'dashboard.recent': 'Activités récentes',
    'dashboard.alerts': 'Alertes intelligentes',
    'dashboard.noAlerts': 'Aucune alerte détectée',
    'dashboard.debts': 'Dettes clients',

    'profile.title': 'Mon profil',
    'reports.title': 'Mes rapports',
    'subscription.title': 'Mon abonnement',

    'login.title': 'Connexion',
    'login.password': 'Mot de passe',
    'login.forgot': 'Mot de passe oublié ?',
    'login.submit': 'Se connecter',
    'login.loading': 'Connexion en cours…',
    'login.create': 'Créer un compte',
    'login.invalidEmail': 'Email invalide',
    'login.badCredentials': 'Email ou mot de passe incorrect.',

    'ashy.needHelp': "Besoin d'aide ?",
    'ashy.chat': 'Discutez avec Ashy',
    'ashy.relaunch': 'Relancer le guide ?',
    'ashy.placeholderGuide': 'Posez une question à Ashy…',
    'ashy.placeholder': 'Votre message…',
    'ashy.copied': 'Copié',
    'ashy.forwardCopied': 'Copié pour transfert',
  },
  en: {
    'nav.guide': 'Ashy Guide',
    'nav.dashboard': 'Dashboard',
    'nav.profile': 'My profile',
    'nav.subscription': 'My subscription',
    'nav.reports': 'My reports',
    'nav.settings': 'Settings',
    'nav.logout': 'Log out',
    'nav.user': 'User',
    'nav.avatarAlt': 'Profile photo',

    'common.cancel': 'Cancel',
    'common.delete': 'Delete',
    'common.close': 'Close',
    'common.you': 'You',
    'common.saving': 'Saving…',
    'common.retry': 'Retry',

    'msg.copy': 'Copy',
    'msg.reply': 'Reply',
    'msg.forward': 'Forward',
    'msg.select': 'Select',
    'msg.delete': 'Delete',
    'msg.yourMessage': 'Your message',
    'msg.actions': 'Message actions',
    'msg.closeMenu': 'Close menu',
    'msg.copied': 'Message copied',
    'msg.copyFail': 'Could not copy',
    'msg.forwardCopied': 'Copied for forwarding',
    'msg.forwardFail': 'Could not forward',
    'msg.deleted': 'Message deleted',
    'msg.deletedPlural': 'Messages deleted',
    'msg.selected': '{{count}} selected',
    'msg.selectedPlural': '{{count}} selected',
    'msg.deselect': 'Deselect',
    'msg.cancelReply': 'Cancel reply',
    'msg.cancelSelect': 'Cancel selection',

    'settings.title': 'Settings',
    'settings.meta': 'Manage your Ash Ledger settings.',
    'settings.guideSection': 'Ashy Guide',
    'settings.relaunchGuide': 'Restart the interactive guide',
    'settings.guideCompleted': 'Review the basics with Ashy (product → stock → sale…)',
    'settings.guideSkipped': 'You skipped the guide — you can resume it here',
    'settings.guideActive': 'Guide in progress — resume with Ashy',
    'settings.guidePending': 'Discover Ash Ledger in under 5 minutes',
    'settings.guideOpened': 'Ashy guide opened…',
    'settings.prefs': 'Preferences',
    'settings.notifications': 'Notifications',
    'settings.notificationsHint': 'Receive alerts and updates',
    'settings.language': 'Language',
    'settings.languageHint': 'Interface language',
    'settings.currency': 'Currency',
    'settings.currencyHint': 'Used for the dashboard, tables, and reports',
    'settings.savePrefs': 'Save preferences',
    'settings.saved': 'Preferences saved!',
    'settings.saveError': 'Could not save preferences.',
    'settings.currencyLoadError': 'Could not load your currency.',
    'settings.security': 'Security',
    'settings.changePassword': 'Change password',
    'settings.oldPassword': 'Current password',
    'settings.newPassword': 'New password',
    'settings.confirmPassword': 'Confirm password',
    'settings.changing': 'Updating…',
    'settings.passwordChanged': 'Password updated successfully!',
    'settings.oldPasswordRequired': 'Enter your current password.',
    'settings.passwordTooShort': 'Password must be at least 8 characters.',
    'settings.passwordMismatch': 'Passwords do not match.',
    'settings.passwordError': 'Incorrect current password or update failed.',
    'settings.danger': 'Danger zone',
    'settings.deleteAccount': 'Delete my account',
    'settings.deleteHint': 'This cannot be undone — all your data will be lost',
    'settings.deleteTitle': 'Delete my account',
    'settings.deleteIrreversible': 'This action cannot be undone',
    'settings.deleteBody': 'All your data will be permanently deleted. Type {{word}} to confirm.',
    'settings.deleteConfirmWord': 'DELETE',
    'settings.deleting': 'Deleting…',
    'settings.deleteTypeError': 'Please type "{{word}}" to confirm.',
    'settings.deleteError': 'Could not delete the account.',

    'dashboard.title': 'Dashboard',
    'dashboard.overview': 'Overview',
    'dashboard.unavailable': 'Data unavailable',
    'dashboard.evolution': 'Financial trend',
    'dashboard.noOps': 'No activity in this period',
    'dashboard.recent': 'Recent activity',
    'dashboard.alerts': 'Smart alerts',
    'dashboard.noAlerts': 'No alerts detected',
    'dashboard.debts': 'Customer debts',

    'profile.title': 'My profile',
    'reports.title': 'My reports',
    'subscription.title': 'My subscription',

    'login.title': 'Sign in',
    'login.password': 'Password',
    'login.forgot': 'Forgot password?',
    'login.submit': 'Sign in',
    'login.loading': 'Signing in…',
    'login.create': 'Create an account',
    'login.invalidEmail': 'Invalid email',
    'login.badCredentials': 'Incorrect email or password.',

    'ashy.needHelp': 'Need help?',
    'ashy.chat': 'Chat with Ashy',
    'ashy.relaunch': 'Restart the guide?',
    'ashy.placeholderGuide': 'Ask Ashy a question…',
    'ashy.placeholder': 'Your message…',
    'ashy.copied': 'Copied',
    'ashy.forwardCopied': 'Copied for forwarding',
  },
};

export function normalizeLang(value) {
  return String(value || '').toLowerCase().startsWith('en') ? 'en' : 'fr';
}

export function readStoredLanguage() {
  try {
    return normalizeLang(localStorage.getItem(STORAGE_KEY) || 'fr');
  } catch {
    return 'fr';
  }
}

export function writeStoredLanguage(lang) {
  const next = normalizeLang(lang);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = next;
  }
  return next;
}

export function translate(lang, key, vars = {}) {
  const dict = DICTS[normalizeLang(lang)] || DICTS.fr;
  let text = dict[key] ?? DICTS.fr[key] ?? key;
  Object.entries(vars).forEach(([k, v]) => {
    text = text.replaceAll(`{{${k}}}`, String(v));
  });
  return text;
}

export function localeForLang(lang) {
  return normalizeLang(lang) === 'en' ? 'en-US' : 'fr-FR';
}
