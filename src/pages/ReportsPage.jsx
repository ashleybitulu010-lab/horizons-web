import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Helmet } from 'react-helmet';
import { ArrowLeft, FileText, Download, BarChart2, TrendingUp, Calendar, FileBarChart } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import pb from '@/lib/pocketbaseClient';
import { motion } from 'framer-motion';
import { cleanUtf8Text } from '@/lib/textEncoding';
import { trackReportGenerated } from '@/lib/analytics';

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

export default function ReportsPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [reports, setReports] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.id) return;
    pb.collection('reports')
      .getFullList({ filter: `owner = "${user.id}"`, sort: '-created' })
      .then(setReports)
      .catch(() => setError('Erreur lors du chargement des rapports.'))
      .finally(() => setLoading(false));
  }, [user?.id]);

  const resolvePdfUrl = (report) => {
    if (report?.pdf_url) return report.pdf_url;
    if (report?.file) {
      try {
        return pb.files.getURL(report, report.file);
      } catch {
        return null;
      }
    }
    return null;
  };

  const handleDownload = (report) => {
    const url = resolvePdfUrl(report);
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
        <title>Mes rapports — Ash Ledger</title>
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
          <h1 className="text-white font-semibold text-base flex-1">Mes rapports</h1>
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
                const pdfUrl = resolvePdfUrl(report);
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
                      disabled={!pdfUrl}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: '#FFF0E6', color: '#FF6B00' }}
                      title={pdfUrl ? 'Télécharger le PDF' : 'PDF non disponible'}
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
