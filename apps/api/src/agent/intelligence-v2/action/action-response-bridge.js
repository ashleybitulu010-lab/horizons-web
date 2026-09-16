import {
	ACTION_PROPOSAL_STATUS,
	ACTION_TYPES,
} from './action-proposal-contract.js';
import { formatMoneyV2 } from '../response/response-formatter-v2.js';

function formatExpenseConfirmation(fields) {
	return `Je vais enregistrer une dépense de ${formatMoneyV2(fields.amount)} pour « ${fields.label} ». Je confirme ?`;
}

function formatSaleConfirmation(fields) {
	const total = fields.quantity != null && fields.unitPrice != null
		? fields.quantity * fields.unitPrice
		: null;
	const totalText = total != null ? formatMoneyV2(total) : '—';
	const unitText = fields.unitPrice != null ? formatMoneyV2(fields.unitPrice) : '—';
	const paidText = fields.amountPaid != null ? formatMoneyV2(fields.amountPaid) : '—';
	return `Je vais enregistrer ${fields.quantity} ${fields.product} à ${unitText} (total ${totalText}, encaissé ${paidText}). Je confirme ?`;
}

function formatExpenseCompleted(fields) {
	return `✅ Dépense enregistrée : ${formatMoneyV2(fields.amount)} pour « ${fields.label} ».`;
}

function formatSaleCompleted(fields) {
	const total = fields.quantity != null && fields.unitPrice != null
		? fields.quantity * fields.unitPrice
		: fields.amountPaid;
	return `✅ Vente enregistrée : ${fields.quantity} ${fields.product} pour ${formatMoneyV2(total)} (encaissé ${formatMoneyV2(fields.amountPaid)}).`;
}

/**
 * Deterministic user-facing text for ActionProposal statuses.
 * Keeps ActionProposal separate from FinancialAnalysisResult.
 */
export function buildActionResponseText(userFacingProposal, context = {}) {
	if (!userFacingProposal) {
		return 'Je n’ai pas pu traiter cette action.';
	}

	const { status, fields, clarificationPrompt, actionType } = userFacingProposal;

	switch (status) {
		case ACTION_PROPOSAL_STATUS.NEEDS_CLARIFICATION:
			return clarificationPrompt || 'Il me manque une information pour enregistrer cette action.';
		case ACTION_PROPOSAL_STATUS.READY_FOR_CONFIRMATION:
		case ACTION_PROPOSAL_STATUS.MODIFICATION_DETECTED:
			if (actionType === ACTION_TYPES.CREATE_EXPENSE) {
				return formatExpenseConfirmation(fields);
			}
			if (actionType === ACTION_TYPES.CREATE_SALE) {
				return formatSaleConfirmation(fields);
			}
			return 'Je peux enregistrer cette action. Confirme avec « oui » pour valider.';
		case ACTION_PROPOSAL_STATUS.CONFIRMATION_REJECTED:
			return 'D’accord, j’annule cette action.';
		case ACTION_PROPOSAL_STATUS.CONFIRMED:
			return 'Confirmation reçue. L’enregistrement sera finalisé prochainement.';
		case ACTION_PROPOSAL_STATUS.COMPLETED:
			if (actionType === ACTION_TYPES.CREATE_EXPENSE) {
				return formatExpenseCompleted(fields);
			}
			if (actionType === ACTION_TYPES.CREATE_SALE) {
				return formatSaleCompleted(fields);
			}
			return '✅ Action enregistrée.';
		case ACTION_PROPOSAL_STATUS.ALREADY_COMPLETED:
			return 'Cette action avait déjà été enregistrée.';
		case ACTION_PROPOSAL_STATUS.FAILED:
			return context.errorMessage || 'Je n’ai pas pu enregistrer cette action. Réessaie ou reformule.';
		case ACTION_PROPOSAL_STATUS.DEFERRED:
			return 'Cette action nécessite une confirmation avant exécution. Je ne l’ai pas encore enregistrée.';
		default:
			return userFacingProposal.description || 'Je traite ta demande.';
	}
}
