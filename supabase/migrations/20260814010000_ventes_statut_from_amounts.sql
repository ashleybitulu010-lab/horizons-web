-- Derive ventes.statut from amounts so "Payé" cannot drift when montant_paye is wrong.
-- total_brut / reste_a_payer remain generated columns — do not write them.

CREATE OR REPLACE FUNCTION public.ventes_autofill_produit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prod record;
  total numeric;
  paye numeric;
BEGIN
  NEW.produit_id := public.resolve_produit_id(NEW.client_id, NEW.libelle, NEW.produit_id);

  IF NEW.produit_id IS NOT NULL THEN
    SELECT nom_produit, prix_vente_unitaire
    INTO prod
    FROM public.produits
    WHERE id = NEW.produit_id;

    IF prod.nom_produit IS NOT NULL AND (NEW.libelle IS NULL OR trim(NEW.libelle) = '') THEN
      NEW.libelle := prod.nom_produit;
    END IF;

    IF prod.prix_vente_unitaire IS NOT NULL AND prod.prix_vente_unitaire > 0 THEN
      NEW.prix_unitaire := prod.prix_vente_unitaire;
    END IF;

    IF (NEW.quantite IS NULL OR NEW.quantite = 0)
       AND NEW.prix_unitaire IS NOT NULL AND NEW.prix_unitaire > 0
       AND NEW.montant_paye IS NOT NULL AND NEW.montant_paye > 0 THEN
      NEW.quantite := ROUND(NEW.montant_paye / NEW.prix_unitaire, 2);
    END IF;
  END IF;

  NEW.quantite := COALESCE(NEW.quantite, 0);
  NEW.prix_unitaire := COALESCE(NEW.prix_unitaire, 0);
  NEW.montant_paye := COALESCE(NEW.montant_paye, 0);
  total := ROUND(NEW.quantite * NEW.prix_unitaire, 2);
  IF NEW.montant_paye > total AND total > 0 THEN
    NEW.montant_paye := total;
  END IF;
  paye := NEW.montant_paye;

  -- Always derive statut from amounts unless cancelled
  IF NEW.statut IS DISTINCT FROM 'Annulé' AND lower(coalesce(NEW.statut, '')) NOT LIKE '%annul%' THEN
    IF total <= 0 THEN
      NEW.statut := COALESCE(NULLIF(trim(NEW.statut), ''), 'en_cours');
    ELSIF paye <= 0 THEN
      NEW.statut := 'Impayé';
    ELSIF paye < total THEN
      NEW.statut := 'Partiel';
    ELSE
      NEW.statut := 'Payé';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ventes_autofill_produit ON public.ventes;
CREATE TRIGGER trg_ventes_autofill_produit
BEFORE INSERT OR UPDATE OF client_id, libelle, produit_id, quantite, montant_paye, prix_unitaire, statut
ON public.ventes
FOR EACH ROW
EXECUTE FUNCTION public.ventes_autofill_produit();
