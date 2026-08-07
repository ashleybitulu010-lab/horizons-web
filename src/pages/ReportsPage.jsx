import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { ArrowLeft, FileText, Download, BarChart2, TrendingUp, Calendar, FileBarChart } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/context/LanguageContext';
import pb from '@/lib/pocketbaseClient';
import { motion } from 'framer-motion';
import { cleanUtf8Text } from '@/lib/textEncoding';
import { trackReportGenerated } from '@/lib/analytics';
import { downloadLocalReport, listLocalReports } from '@/lib/saveReport';

const TYPE_LABELS = {
  monthly: 'Rapport mensuel',
  quarterly: 'Rapport trimestriel',
  annual: 'Rapport annuel',
  custom: 'Rapport personnalisé',
};

const TYPE_ICONS = {
  monthly: BarChart2,
  quarterly: TrendingUp,
  annual: FileBarChart,
  custom: FileText,
};

const TYPE_COLORS = {
  monthly: '#3B82F6',
  quarterly: '#8B5CF6',
  annual: '#FF6B00',
  custom: '#10B981',
};

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

function mergeReports(remote = [], local = []) {
  const byId = new Map();
  remote.forEach((r) => {
    if (r?.id) byId.set(String(r.id), { ...r, _source: 'pocketbase' });
  });
  local.forEach((r) => {
    const key = String(r.id);
    const existing = byId.get(key);
    if (!existing) {
      byId.set(key, { ...r, _source: 'local' });
      return;
    }
    // Prefer PB metadata but keep local blob for download if PB file missing.
    byId.set(key, {
      ...existing,
      blob: r.blob || existing.blob,
      filename: r.filename || existing.filename,
      _source: existing.file || existing.pdf_url ? 'pocketbase' : 'local',
    });
  });
  return [...byId.values()].sort(
    (a, b) => new Date(b.created || 0).getTime() - new Date(a.created || 0).getTime(),
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState(null);

  const loadReports = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const [remote, local] = await Promise.all([
        pb.collection('reports')
          .getFullList({ filter: `owner = "${user.id}"`, sort: '-created' })
          .catch(() => []),
        listLocalReports(user.id),
      ]);
      setReports(mergeReports(remote, local));
    } catch {
      setError('Erreur lors du chargement des rapports.');
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleDownload = (report) => {
    if (report?.blob) {
      downloadLocalReport(report);
      trackReportGenerated({
        source: 'reports_page_download',
        report_type: report?.type || 'unknown',
      });
      return;
    }
    let url = report?.pdf_url || null;
    if (!url && report?.file) {
      try {
        url = pb.files.getURL(report, report.file);
      } catch {
        url = null;
      }
    }
    if (url) {
      trackReportGenerated({
        source: 'reports_page_download',
        report_type: report?.type || 'unknown',
      });
      window.open(url, '_blank', 'noopener noreferrer');
    }
  };

  return (
    <>
      <Helmet>
        <title>{t('reports.title')} — Ash Ledger</title>
        <meta name="description" content="Consultez et téléchargez vos rapports Ash Ledger." />
      </Helmet>

      <div className="min-h-[100dvh] flex flex-col" style={{ backgroundColor: '#F5F1EB' }}>
        <header
          className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{ backgroundColor: '#FF6B00', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }}
        >
          <button
            onClick={() => navigate('/chat')}
            className="w-9 h-9 flex items-center justify-center rounded-full text-white/80 hover:text-white hover:bg-white/15 transition-colors active:scale-95"
          >
            <ArrowLeft size={20} strokeWidth={2} />
          </button>
          <h1 className="text-white font-semibold text-base flex-1">{t('reports.title')}</h1>
          {!loading && reports.length > 0 && (
            <span className="text-orange-100 text-xs font-medium bg-white/20 px-2.5 py-1 rounded-full">
              {reports.length} rapport{reports.length > 1 ? 's' : ''}
            </span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-6 max-w-lg mx-auto w-full">
          {loading ? (
            <div className="flex justify-center py-16">
              <div className="w-8 h-8 rounded-full border-2 border-orange-400 border-t-transparent animate-spin" />
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-2xl p-5 text-center">
              <p className="text-red-600 text-sm font-medium">{error}</p>
            </div>
          ) : reports.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center py-20 text-center"
            >
              <div
                className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5 shadow-sm"
                style={{ backgroundColor: '#FFF0E6' }}
              >
                <FileText size={36} className="text-orange-300" strokeWidth={1.4} />
              </div>
              <h2 className="text-gray-700 font-semibold text-base mb-2">Aucun rapport disponible</h2>
              <p className="text-gray-400 text-sm leading-relaxed max-w-xs mb-4">
                Demandez à Ashy dans le chat : « Génère mon bilan PDF ». Vos rapports apparaîtront ici.
              </p>
              <button
                type="button"
                onClick={() => navigate('/chat')}
                className="px-4 py-2.5 rounded-xl text-white text-sm font-semibold active:scale-95"
                style={{ backgroundColor: '#FF6B00' }}
              >
                Ouvrir le chat
              </button>
            </motion.div>
          ) : (
            <div className="space-y-3">
              {reports.map((report, i) => {
                const Icon = TYPE_ICONS[report.type] || FileText;
                const color = TYPE_COLORS[report.type] || '#FF6B00';
                const canDownload = Boolean(report.blob || report.pdf_url || report.file);
                return (
                  <motion.div
                    key={report.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="bg-white rounded-2xl shadow-sm p-4 flex items-center gap-4"
                  >
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: `${color}18` }}
                    >
                      <Icon size={22} strokeWidth={1.8} style={{ color }} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-800 truncate">
                        {cleanUtf8Text(report.title)}
                      </p>
                      <p className="text-xs text-gray-400 font-medium mt-0.5">
                        {TYPE_LABELS[report.type] || 'Rapport'}
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        <Calendar size={11} className="text-gray-300" />
                        <span className="text-xs text-gray-400">{formatDate(report.created)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDownload(report)}
                      disabled={!canDownload}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: '#FFF0E6', color: '#FF6B00' }}
                      title={canDownload ? 'Télécharger le PDF' : 'PDF non disponible'}
                    >
                      <Download size={13} strokeWidth={2} />
                      <span className="hidden sm:inline">PDF</span>
                    </button>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
