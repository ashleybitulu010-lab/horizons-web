-- Keep ventes/stocks linked to produits and derive unit price from catalogue.
-- total_brut / reste_a_payer are generated columns — do not write them.

CREATE OR REPLACE FUNCTION public.resolve_produit_id(
  p_client_id uuid,
  p_label text,
  p_existing uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  matched uuid;
BEGIN
  IF p_existing IS NOT NULL THEN
    RETURN p_existing;
  END IF;
  IF p_client_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_label IS NOT NULL AND trim(p_label) <> '' THEN
    SELECT p.id INTO matched
    FROM public.produits p
    WHERE p.client_id = p_client_id
      AND (
        lower(trim(p.nom_produit)) = lower(trim(p_label))
        OR lower(trim(p_label)) LIKE '%' || lower(trim(p.nom_produit)) || '%'
        OR lower(trim(p.nom_produit)) LIKE '%' || lower(trim(p_label)) || '%'
      )
    ORDER BY p.created_at DESC NULLS LAST
    LIMIT 1;
    IF matched IS NOT NULL THEN
      RETURN matched;
    END IF;
  END IF;

  -- Fallback: single product for this client
  IF (SELECT count(*) FROM public.produits p WHERE p.client_id = p_client_id) = 1 THEN
    SELECT p.id INTO matched
    FROM public.produits p
    WHERE p.client_id = p_client_id
    LIMIT 1;
  END IF;

  RETURN matched;
END;
$$;

CREATE OR REPLACE FUNCTION public.ventes_autofill_produit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prod record;
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

    -- Unit price always comes from product sale price when available
    IF prod.prix_vente_unitaire IS NOT NULL AND prod.prix_vente_unitaire > 0 THEN
      NEW.prix_unitaire := prod.prix_vente_unitaire;
    END IF;

    IF (NEW.quantite IS NULL OR NEW.quantite = 0)
       AND NEW.prix_unitaire IS NOT NULL AND NEW.prix_unitaire > 0
       AND NEW.montant_paye IS NOT NULL AND NEW.montant_paye > 0 THEN
      NEW.quantite := ROUND(NEW.montant_paye / NEW.prix_unitaire, 2);
    END IF;

    IF NEW.statut IS NULL OR trim(NEW.statut) = '' THEN
      IF COALESCE(NEW.montant_paye, 0) <= 0 THEN
        NEW.statut := 'Impayé';
      ELSIF NEW.quantite IS NOT NULL
        AND NEW.prix_unitaire IS NOT NULL
        AND COALESCE(NEW.montant_paye, 0) < (NEW.quantite * NEW.prix_unitaire) THEN
        NEW.statut := 'Partiel';
      ELSE
        NEW.statut := 'Payé';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ventes_autofill_produit ON public.ventes;
CREATE TRIGGER trg_ventes_autofill_produit
BEFORE INSERT OR UPDATE OF client_id, libelle, produit_id, quantite, montant_paye, prix_unitaire
ON public.ventes
FOR EACH ROW
EXECUTE FUNCTION public.ventes_autofill_produit();

CREATE OR REPLACE FUNCTION public.stocks_autofill_produit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prod_name text;
BEGIN
  NEW.produit_id := public.resolve_produit_id(NEW.client_id, NEW.nom_article, NEW.produit_id);

  IF NEW.produit_id IS NOT NULL THEN
    SELECT nom_produit INTO prod_name
    FROM public.produits
    WHERE id = NEW.produit_id;

    IF prod_name IS NOT NULL AND (NEW.nom_article IS NULL OR trim(NEW.nom_article) = '') THEN
      NEW.nom_article := prod_name;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_stocks_autofill_produit ON public.stocks;
CREATE TRIGGER trg_stocks_autofill_produit
BEFORE INSERT OR UPDATE OF client_id, nom_article, produit_id
ON public.stocks
FOR EACH ROW
EXECUTE FUNCTION public.stocks_autofill_produit();
