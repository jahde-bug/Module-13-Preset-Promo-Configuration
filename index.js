(function () {
  "use strict";

  // Ito ang default/paunang promo na palaging naka-load kapag unang binuksan
  // ang page. Hindi ito matatanggal (ang "promo1" ay protektado sa Delete).
  const defaultPromo = {
    id: "promo1",
    name: "B1T1 Promo",
    discountType: "b1t1_bundle",
    discountValue: 3200,
    discountRule: "Flat ₱3,200 discount on eligible shoes (Buy 1 Take 1 bundle)",
    appliesTo: "eligible shoes (Buy 1 Take 1 bundle)",
    active: true
  };

  // Listahan ng lahat ng na-save na promo. Dito nakatago ang "state"
  // (kasalukuyang datos) ng buong system habang bukas ang page.
  const savedPromos = [{ ...defaultPromo }];
  // ID ng promo na kasalukuyang naka-display/nire-edit sa Admin form sa ibaba.
  let draftPromoId = defaultPromo.id;
  // Counter para sa susunod na awtomatikong ID kada bagong idinagdag na promo.
  let nextPromoId = 2;
  // Panandaliang "trash bin" ng mga na-delete na promo, para gumana ang Undo.
  const deletedPromos = [];

  // Kasalukuyang laman ng search box — ginagamit para i-filter ang mga rows
  // na ipinapakita sa table (hindi nito binabago ang savedPromos mismo).
  let searchQuery = "";
  // Kasalukuyang column ang pinagbabatayan ng pag-sort ("name", "discountType",
  // o "active"), at kung papataas (asc) o pababa (desc) ang direksyon nito.
  // Null ang sortKey kapag wala pang column na pinili ng user.
  let sortKey = null;
  let sortDirection = "asc";

  // ---------------------------------------------------------------------
  // ROLE-BASED PERMISSIONS (prototype lang)
  // "admin"   = pwedeng mag-Edit, mag-Delete, mag-Add, at mag-Undo/Restore
  // "cashier" = View lang at pwedeng i-"apply" (i-toggle ang Active/Inactive)
  //             ang isang promo; walang access sa Admin form / Edit / Delete
  // ---------------------------------------------------------------------
  let currentRole = "cashier";

  // Kinukuha lahat ng elemento sa HTML (table, mga input, mga button) para
  // hindi na kailangang i-type paulit-ulit ang document.getElementById().
  function getDom() {
    return {
      ruleSummaryBody: document.getElementById("ruleSummaryBody"),
      restorePromoBtn: document.getElementById("restorePromoBtn"),
      addPromoBtn: document.getElementById("addPromoBtn"),
      adminRuleName: document.getElementById("adminRuleName"),
      adminDiscountRule: document.getElementById("adminDiscountRule"),
      adminDiscountType: document.getElementById("adminDiscountType"),
      adminDiscountValueAmount: document.getElementById("adminDiscountValueAmount"),
      adminDiscountValuePercent: document.getElementById("adminDiscountValuePercent"),
      discountValueAmountField: document.getElementById("discountValueAmountField"),
      discountValuePercentField: document.getElementById("discountValuePercentField"),
      adminAppliesTo: document.getElementById("adminAppliesTo"),
      btnSavePreset: document.getElementById("btnSavePreset"),
      roleLabel: document.getElementById("roleLabel"),
      switchRoleBtn: document.getElementById("switchRoleBtn"),
      adminSection: document.getElementById("adminSection"),
      roleModalOverlay: document.getElementById("roleModalOverlay"),
      roleModalClose: document.getElementById("roleModalClose"),
      roleModalYes: document.getElementById("roleModalYes"),
      roleModalNo: document.getElementById("roleModalNo"),
      searchInput: document.getElementById("promoSearchInput"),
      searchBtn: document.getElementById("searchBtn"),
      sortAlphaBtn: document.getElementById("sortAlphaBtn"),
      sortableHeaders: document.querySelectorAll("[data-sort-key]")
    };
  }

  // Pinupuno ang "DISCOUNT PERCENTAGE (%)" dropdown ng mga opsyon mula 1%
  // hanggang 100%. Isang beses lang itong tumatakbo, sa simula ng system.
  function populatePercentOptions() {
    const dom = getDom();
    let html = "";
    let percent = 1;
    while (percent <= 100) {
      html += `<option value="${percent}">${percent}%</option>`;
      percent++;
    }
    dom.adminDiscountValuePercent.innerHTML = html;
  }

  // Ipinapakita lang ang isa sa dalawang "discount value" field base sa
  // kasalukuyang pinili sa DISCOUNT TYPE dropdown: kung "Flat Bundle Amount",
  // lalabas ang libreng-input na textbox (pwedeng ilagay kahit anong halaga);
  // kung "Percentage Off", lalabas sa halip ang 1%-100% na dropdown. Ang
  // hindi ginagamit na field ay parehong itinatago (hidden) AT dine-disable,
  // para talagang hindi ito ma-access/ma-focus/ma-type habang nakatago.
  function updateDiscountValueVisibility() {
    const dom = getDom();
    const isPercentage = dom.adminDiscountType.value === "percentage";

    dom.discountValueAmountField.hidden = isPercentage;
    dom.adminDiscountValueAmount.disabled = isPercentage;

    dom.discountValuePercentField.hidden = !isPercentage;
    dom.adminDiscountValuePercent.disabled = !isPercentage;
  }

  // Binabasa ang kasalukuyang laman ng Admin form (mga textbox/dropdown) at
  // ginagawang isang plain object na "draft" na promo. Kung walang laman ang
  // isang field, gumagamit ng default na text (fallback).
  function getDraft() {
    const dom = getDom();
    return {
      id: draftPromoId,
      name: dom.adminRuleName.value.trim() || "Untitled Promo",
      discountType: dom.adminDiscountType.value,
      // Kunin ang halaga mula sa dropdown (1-100) kapag Percentage, o mula
      // sa libreng-input na textbox kapag Flat Bundle Amount.
      discountValue: dom.adminDiscountType.value === "percentage"
        ? Number(dom.adminDiscountValuePercent.value) || 1
        : Number(dom.adminDiscountValueAmount.value) || 0,
      discountRule: dom.adminDiscountRule.value.trim() || "Custom discount rule",
      appliesTo: dom.adminAppliesTo.value.trim() || "Eligible items",
      // Panatilihin ang dating "active/inactive" status ng promo na ito kung
      // meron nang naka-save; kung wala pa (bagong promo), gawing active.
      active: savedPromos.find(function (promo) {
        return promo.id === draftPromoId;
      })?.active ?? true
    };
  }

  // Sini-sanitize/tinatanggal ang mga espesyal na character (<, >, ", ', &)
  // bago i-insert ang text sa innerHTML, para maiwasan ang HTML/script
  // injection mula sa mga inilagay na pangalan o detalye ng promo.
  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  // Inilalagay sa Admin form ang detalye ng piniling promo (ginagamit kapag
  // pinindot ang "Edit", nagdagdag ng bagong promo, o nag-restore/undo).
  function loadDraft(promo) {
    const dom = getDom();
    draftPromoId = promo.id;
    dom.adminRuleName.value = promo.name;
    dom.adminDiscountRule.value = promo.discountRule;
    dom.adminDiscountType.value = promo.discountType;
    dom.adminAppliesTo.value = promo.appliesTo;

    // Ipinapakita ang tamang value field (textbox o dropdown) base sa
    // discountType ng promo, at inilalagay doon ang naka-save nang halaga.
    updateDiscountValueVisibility();
    if (promo.discountType === "percentage") {
      dom.adminDiscountValuePercent.value = String(promo.discountValue ?? 1);
    } else {
      dom.adminDiscountValueAmount.value = promo.discountValue ?? "";
    }
  }

  // Nagpapakita ng custom na "Are you admin?" dialog (hindi na gamit ang
  // built-in na window.confirm(), dahil hindi ito ma-cu-customize: hindi
  // matatanggal ang default title nito ("Code"), hindi mapapalitan ang
  // OK/Cancel na label, at kapag pinindot ang X, ganoon pa rin ang
  // ibinabalik na sagot gaya ng Cancel.
  //
  // Sa custom dialog na ito:
  // - Yes button  -> nagre-resolve ng "admin"
  // - No button   -> nagre-resolve ng "cashier"
  // - X (close)   -> nagre-resolve ng null, ibig sabihin "walang pagbabago"
  //                  (isasara lang ang dialog, mananatili ang kasalukuyang
  //                  role)
  //
  // Nagre-return ito ng Promise dahil kailangang hintayin muna ang click
  // ng user bago malaman ang sagot (asynchronous, hindi tulad ng
  // window.confirm() na sunod-sunod/blocking).
  function askIfAdmin() {
    console.log("Are you admin?");
    const dom = getDom();

    return new Promise(function (resolve) {
      dom.roleModalOverlay.hidden = false;

      function cleanup() {
        dom.roleModalOverlay.hidden = true;
        dom.roleModalYes.removeEventListener("click", onYes);
        dom.roleModalNo.removeEventListener("click", onNo);
        dom.roleModalClose.removeEventListener("click", onClose);
      }

      function onYes() {
        console.log("Sagot: Yes — Admin access (pwedeng mag-Edit/Delete).");
        cleanup();
        resolve("admin");
      }

      function onNo() {
        console.log("Sagot: No — Cashier access lang (View/Apply lang).");
        cleanup();
        resolve("cashier");
      }

      function onClose() {
        console.log("Isinara gamit ang X — nananatili ang kasalukuyang role, walang binago.");
        cleanup();
        resolve(null);
      }

      dom.roleModalYes.addEventListener("click", onYes);
      dom.roleModalNo.addEventListener("click", onNo);
      dom.roleModalClose.addEventListener("click", onClose);
    });
  }

  // Ina-apply ang restriction sa UI base sa currentRole:
  // - Itinatago ang buong "Admin — Configure Preset Rules" card (kasama
  //   ang Save Preset at Add New Promo) kapag cashier, dahil parte ito ng
  //   pag-edit ng mga preset rule.
  // - Ang Undo/Restore button ay para lang sa Admin, dahil kaugnay ito ng
  //   Delete na admin-only na aksyon.
  // - Ina-update din ang label sa header ("Role: Admin" / "Role: Cashier").
  // Ang Edit/Delete buttons sa loob ng table ay hina-handle sa
  // renderOverview() mismo, dahil doon din ginagawa ang mga button na iyon.
  //
  // Kung null ang ipinasang role (ibig sabihin, pinindot ang X sa dialog),
  // wala itong ginagawa — walang pagbabago sa kasalukuyang role/UI.
  function setRole(role) {
    if (role === null) return;
    currentRole = role;
    const dom = getDom();
    const isAdmin = currentRole === "admin";

    dom.roleLabel.textContent = isAdmin ? "Admin" : "Cashier";
    dom.adminSection.style.display = isAdmin ? "" : "none";
    dom.restorePromoBtn.style.display = isAdmin ? "" : "none";
  }

  // Isinasalin ang internal na discountType (hal. "b1t1_bundle") papunta sa
  // mas madaling basahing label. Ginagamit ito ng renderOverview (display)
  // at ng search/sort (para maghanap/mag-ayos base sa label mismo, hindi sa
  // internal value).
  function getDiscountTypeLabel(promo) {
    if (promo.discountType === "b1t1_bundle") return "Flat Bundle Amount (₱)";
    if (promo.discountType === "percentage") return "Percentage Off (%)";
    return "Custom";
  }

  // Ibinabalik ang listahan ng mga promo na dapat ipakita sa table — una,
  // ini-filter base sa searchQuery (tumutugma sa button name, discount
  // rule, discount type label, o applies-to), pagkatapos ini-sort base sa
  // sortKey/sortDirection kung may napiling column. Hindi nito ginagalaw
  // ang savedPromos mismo — bagong array lang ang ginagawa dito.
  function getVisiblePromos() {
    const query = searchQuery.trim().toLowerCase();
    let visible = [];
    let index = 0;
    while (index < savedPromos.length) {
      const promo = savedPromos[index];
      const haystack = `${promo.name} ${promo.discountRule} ${getDiscountTypeLabel(promo)} ${promo.appliesTo}`.toLowerCase();
      if (query === "" || haystack.includes(query)) visible[visible.length] = promo;
      index++;
    }

    if (sortKey) {
      visible.sort(function (a, b) {
        let valueA;
        let valueB;
        if (sortKey === "name") {
          valueA = a.name.toLowerCase();
          valueB = b.name.toLowerCase();
        } else if (sortKey === "discountType") {
          valueA = getDiscountTypeLabel(a).toLowerCase();
          valueB = getDiscountTypeLabel(b).toLowerCase();
        } else if (sortKey === "active") {
          valueA = a.active ? 1 : 0;
          valueB = b.active ? 1 : 0;
        }
        if (valueA < valueB) return sortDirection === "asc" ? -1 : 1;
        if (valueA > valueB) return sortDirection === "asc" ? 1 : -1;
        return 0;
      });
    }

    return visible;
  }

  // Ina-update ang tatlong sortable header (Button / Discount Type / Status)
  // para lumabas ang ▲/▼ arrow sa kasalukuyang sort column lang, at malinaw
  // itong makikita (mas maputing kulay) kumpara sa ibang header.
  function updateSortIndicators() {
    const dom = getDom();
    dom.sortableHeaders.forEach(function (th) {
      th.classList.remove("sort-active");
      const indicator = th.querySelector("[data-sort-indicator]");
      if (indicator) indicator.textContent = "";
    });

    // "Sort A-Z" toolbar button: sinasalamin din nito ang parehong state,
    // kahit sa "Button" column header mismo pinindot ang pag-sort (at
    // baliktad — kaya laging magkasabay ang dalawang paraan ng pag-sort).
    const isNameSort = sortKey === "name";
    dom.sortAlphaBtn.classList.toggle("sort-active", isNameSort);
    dom.sortAlphaBtn.textContent = isNameSort && sortDirection === "desc" ? "Sort Z-A" : "Sort A-Z";

    if (!sortKey) return;
    const activeHeader = document.querySelector(`[data-sort-key="${sortKey}"]`);
    if (!activeHeader) return;
    activeHeader.classList.add("sort-active");
    const indicator = activeHeader.querySelector("[data-sort-indicator]");
    if (indicator) indicator.textContent = sortDirection === "asc" ? "▲" : "▼";
  }

  // Naghahanap ng susunod na available na pangalan para sa bagong promo
  // (hal. "Promo 1", "Promo 2"...) para walang magkaparehong pangalan.
  function getNextPromoNumber() {
    let number = 1;
    let available = false;
    while (!available) {
      available = true;
      let index = 0;
      while (index < savedPromos.length) {
        if (savedPromos[index].name === `Promo ${number}`) available = false;
        index++;
      }
      if (!available) number++;
    }
    return number;
  }

  // Ginagawa/binubuo ang buong tabular na listahan (rows) sa "Current
  // Presets Overview" batay sa laman ng savedPromos, kasama ang mga button
  // para sa Edit/Delete at ang toggle ng Active/Inactive status.
  function renderOverview() {
    const dom = getDom();
    const visiblePromos = getVisiblePromos();
    let rows = "";
    let index = 0;
    while (index < visiblePromos.length) {
      const promo = visiblePromos[index];

      // Itinatakda kung "Active" o "Inactive" ang ipapakitang status text
      // at kung anong CSS class ang gagamitin para dito.
      let statusClass = "";
      let statusText = "Active";
      if (!promo.active) {
        statusClass = "inactive";
        statusText = "Inactive";
      }

      // Mas madaling basahing label ng discount type (gamit ang shared
      // helper para pareho ito sa ginagamit ng search/sort).
      const discountType = getDiscountTypeLabel(promo);

      // Palagi meron "Edit" button, pero ang "Delete" ay itinatago para sa
      // default na "promo1" dahil hindi ito dapat matanggal. Dagdag pa,
      // pareho itong Edit at Delete ay para lang sa Admin — kung Cashier
      // ang naka-login, wala talagang lalabas na Edit/Delete button dito
      // (View + i-apply/i-toggle na lang ang Active/Inactive status).
      let actions = "";
      if (currentRole === "admin") {
        actions = `<button type="button" class="btn-preset-edit" data-edit-promo-id="${escapeHtml(promo.id)}">Edit</button>`;
        if (promo.id !== "promo1") {
          actions += ` <button type="button" class="btn-preset-delete" data-delete-promo-id="${escapeHtml(promo.id)}">Delete</button>`;
        }
      }

      // Binubuo ang isang <tr> row para sa promo na ito, kasama ang lahat
      // ng column (Button, Discount Rule, Discount Type, Applies To,
      // Status, Actions).
      rows += `
        <tr data-promo-id="${escapeHtml(promo.id)}">
          <td class="cell-btn-name">${escapeHtml(promo.name)}</td>
          <td>${escapeHtml(promo.discountRule)}</td>
          <td>${escapeHtml(discountType)}</td>
          <td>${escapeHtml(promo.appliesTo)}</td>
          <td class="cell-status ${statusClass}">
            <button type="button" class="status-toggle ${statusClass}" data-status-promo-id="${escapeHtml(promo.id)}" aria-label="Set ${escapeHtml(promo.name)} ${statusText === "Active" ? "inactive" : "active"}">${statusText}</button>
          </td>
          <td class="preset-actions">${actions}</td>
        </tr>`;
      index++;
    }

    // Kung walang tumugma sa search query, magpakita ng isang mensahe sa
    // loob ng table imbes na iwanang blangko ang tbody.
    if (visiblePromos.length === 0) {
      rows = `<tr class="empty-row"><td class="empty-row-cell" colspan="6">No promos match your search.</td></tr>`;
    }

    // Ipinapakita sa table ang mga na-buong rows, at ini-enable/dine-disable
    // ang Undo button depende kung may laman ang "trash bin" ng deleted promos.
    // Ang Undo/deletedPromos ay hiwalay sa search filter — total count pa
    // rin ng savedPromos/deletedPromos ang basehan nito, hindi ng visible list.
    dom.ruleSummaryBody.innerHTML = rows;
    dom.restorePromoBtn.disabled = deletedPromos.length === 0;
    updateSortIndicators();
  }

  // Central na function na tumatawag sa lahat ng kailangang i-render/i-refresh
  // sa screen. Dito lang dapat dumaan kapag may pagbabago sa data.
  function render() {
    renderOverview();
  }

  // Dito nakadikit (bind) ang lahat ng event listener/click handler ng mga
  // button at ang table, para malaman ng system kung ano ang gagawin kapag
  // pinindot ng user ang bawat isa.
  function bindEvents() {
    const dom = getDom();

    // "DISCOUNT TYPE" dropdown: pag pinalitan (Flat Bundle Amount <->
    // Percentage Off), agad na pinapalitan din kung textbox o dropdown ang
    // lalabas sa "discount value" field sa ibaba nito.
    dom.adminDiscountType.addEventListener("change", function () {
      updateDiscountValueVisibility();
    });

    // "SAVE PRESET" button: kinukuha ang laman ng Admin form (draft) at
    // ise-save ito — pinapalitan ang existing promo kung may match na ID,
    // o dinadagdag bilang bago kung wala pang match. Admin-only na aksyon
    // ito (bahagi ng "Edit"), kaya may extra check dito kahit nakatago na
    // ang buong Admin card para sa Cashier.
    dom.btnSavePreset.addEventListener("click", function () {
      if (currentRole !== "admin") return;
      const draft = getDraft();
      let savedIndex = -1;
      let index = 0;
      while (index < savedPromos.length) {
        if (savedPromos[index].id === draft.id) savedIndex = index;
        index++;
      }
      if (savedIndex === -1) {
        savedPromos[savedPromos.length] = draft;
      } else {
        savedPromos[savedIndex] = draft;
      }
      render();
    });

    // "+ ADD NEW PROMO" button: gumagawa ng bagong promo na base sa default
    // template, binibigyan ng bagong ID at pangalan, idinaragdag sa listahan,
    // at ini-load ito agad sa Admin form para direkta na maaring i-edit.
    // Admin-only din ito dahil bahagi ito ng pag-configure ng mga preset.
    dom.addPromoBtn.addEventListener("click", function () {
      if (currentRole !== "admin") return;
      const promoNumber = getNextPromoNumber();
      const newPromo = {
        ...defaultPromo,
        id: `promo${nextPromoId++}`,
        name: `Promo ${promoNumber}`
      };
      savedPromos[savedPromos.length] = newPromo;
      loadDraft(newPromo);
      render();
      dom.adminRuleName.focus();
    });

    // Isang click listener lang ang nakadikit sa buong table body (event
    // delegation), pagkatapos ay tinitignan kung anong button ang aktwal
    // na pinindot ng user base sa data attributes nito.
    dom.ruleSummaryBody.addEventListener("click", function (event) {
      const statusButton = event.target.closest("[data-status-promo-id]");
      const editButton = event.target.closest("[data-edit-promo-id]");
      const deleteButton = event.target.closest("[data-delete-promo-id]");

      // Pinindot ang Active/Inactive status toggle: babaligtarin (true/false)
      // ang status ng kaukulang promo, at ia-update din ang Admin form kung
      // ito rin ang kasalukuyang naka-display doon.
      if (statusButton) {
        let index = 0;
        while (index < savedPromos.length) {
          if (savedPromos[index].id === statusButton.dataset.statusPromoId) {
            savedPromos[index].active = !savedPromos[index].active;
            if (draftPromoId === savedPromos[index].id) loadDraft(savedPromos[index]);
          }
          index++;
        }
        render();
        return;
      }

      // Pinindot ang "Edit": hinahanap ang piniling promo at ini-load ang
      // detalye nito papunta sa Admin form para maaring baguhin. Admin-only.
      if (editButton) {
        if (currentRole !== "admin") return;
        let index = 0;
        while (index < savedPromos.length) {
          if (savedPromos[index].id === editButton.dataset.editPromoId) loadDraft(savedPromos[index]);
          index++;
        }
        return;
      }

      // Pinindot ang "Delete": tinatanggal ang promo mula sa savedPromos
      // pero hindi talaga ito buburahin — isinasave muna sa deletedPromos
      // (kasama ang orihinal na posisyon nito) para pwedeng ibalik gamit
      // ang Undo. May proteksyon din para hindi matanggal ang huling
      // natitirang promo o ang default na "promo1". Admin-only na aksyon.
      if (deleteButton) {
        if (currentRole !== "admin") return;
        if (savedPromos.length === 1) return;
        let deletedIndex = -1;
        let index = 0;
        while (index < savedPromos.length) {
          if (savedPromos[index].id === deleteButton.dataset.deletePromoId) deletedIndex = index;
          index++;
        }
        if (deletedIndex === -1) return;
        if (savedPromos[deletedIndex].id === "promo1") return;

        const deletedPromoId = savedPromos[deletedIndex].id;
        deletedPromos[deletedPromos.length] = {
          promo: { ...savedPromos[deletedIndex] },
          index: deletedIndex
        };

        // Inaalis ang promo sa array sa pamamagitan ng pag-shift ng mga
        // susunod na item paatras ng isang posisyon (parang manual splice).
        index = deletedIndex;
        while (index < savedPromos.length - 1) {
          savedPromos[index] = savedPromos[index + 1];
          index++;
        }
        savedPromos.length = savedPromos.length - 1;

        // Kung ang na-delete pala ay siya mismong nasa Admin form ngayon,
        // ilipat ang form sa unang natitirang promo para hindi ito "orphan".
        if (draftPromoId === deletedPromoId) loadDraft(savedPromos[0]);
        render();
      }
    });

    // Search box: kada pag-type, ina-update ang searchQuery state at
    // ire-render ulit ang table para lumabas lang ang mga tumutugma na
    // promo. Hindi nito nawawala ang focus ng input habang nagta-type,
    // dahil ang searchInput ay nasa labas ng ruleSummaryBody — hindi ito
    // apektado ng pag-rebuild ng innerHTML nito.
    dom.searchInput.addEventListener("input", function () {
      searchQuery = dom.searchInput.value;
      render();
    });

    // "Search" button: eksaktong parehong resulta ng pag-type sa search box
    // — inilalapat lang nito nang explicit/on-click ang kasalukuyang laman
    // ng input bilang searchQuery. Alternatibong paraan ito ng pag-search,
    // hal. para sa mga user na mas gusto ang pindot-button kaysa live-type.
    dom.searchBtn.addEventListener("click", function () {
      searchQuery = dom.searchInput.value;
      render();
    });

    // Mga sortable column header (Button / Discount Type / Status): pag
    // pinindot, ginagawang bagong sort key ang column na iyon (simula sa
    // ascending). Kung ito na mismo ang kasalukuyang sort column, babaligtarin
    // na lang ang direction (ascending <-> descending) sa halip na magpalit
    // ng column.
    dom.sortableHeaders.forEach(function (th) {
      th.addEventListener("click", function () {
        const key = th.dataset.sortKey;
        if (sortKey === key) {
          sortDirection = sortDirection === "asc" ? "desc" : "asc";
        } else {
          sortKey = key;
          sortDirection = "asc";
        }
        render();
      });
    });

    // "Sort A-Z" toolbar button: hiwalay na paraan (bukod sa Button column
    // header) para i-sort ang mga promo nang alphabetical base sa pangalan.
    // Pag pinindot ulit habang naka-alphabetical na, babaligtarin ang
    // direction (A-Z -> Z-A), gaya rin ng ugali ng column header sort.
    dom.sortAlphaBtn.addEventListener("click", function () {
      if (sortKey === "name") {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortKey = "name";
        sortDirection = "asc";
      }
      render();
    });

    // "Undo" button: ibinabalik ang huling na-delete na promo pabalik sa
    // savedPromos, sa dati (o pinakamalapit) nitong posisyon, at inaalis
    // ito sa listahan ng deletedPromos. Admin-only, dahil kaugnay ito ng
    // Delete na aksyon na admin-only din.
    dom.restorePromoBtn.addEventListener("click", function () {
      if (currentRole !== "admin") return;
      if (deletedPromos.length === 0) return;
      const lastDeletedIndex = deletedPromos.length - 1;
      const deletedPromo = deletedPromos[lastDeletedIndex];

      let restoreIndex = deletedPromo.index;
      if (restoreIndex > savedPromos.length) restoreIndex = savedPromos.length;

      // Nagbibigay ng puwang sa dating posisyon sa pamamagitan ng pag-shift
      // pasulong ng mga susunod na item, bago ilagay pabalik ang na-delete.
      let index = savedPromos.length;
      while (index > restoreIndex) {
        savedPromos[index] = savedPromos[index - 1];
        index--;
      }
      savedPromos[restoreIndex] = deletedPromo.promo;

      deletedPromos.length = lastDeletedIndex;
      render();
    });

    // "Switch Role" button: para lang sa prototype/testing — nagpapakita
    // ulit ng "Are you admin?" dialog, at ina-apply agad ang bagong access
    // level (kung sakaling may sagot) nang hindi na kailangang mag-reload
    // ng page.
    dom.switchRoleBtn.addEventListener("click", function () {
      askIfAdmin().then(function (role) {
        setRole(role);
        render();
      });
    });
  }

  // Simula ng buong system: idinidikit muna ang lahat ng event listeners,
  // ilo-load ang default promo sa Admin form, ire-render muna gamit ang
  // paunang/default na role (Cashier) habang bukas pa ang dialog, at kapag
  // nasagot na ang "Are you admin?" dialog, ia-apply ang napiling access
  // level bago ire-render ulit.
  function initialize() {
    populatePercentOptions();
    bindEvents();
    loadDraft(defaultPromo);
    setRole(currentRole);
    render();

    askIfAdmin().then(function (role) {
      setRole(role);
      render();
    });
  }

  // Sinisiguro na hihintayin munang matapos mag-load ang buong HTML bago
  // patakbuhin ang initialize(), para siguradong nandiyan na ang mga
  // elemento (table, buttons, inputs) na ginagamit ng script.
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", initialize);
  else initialize();
})();
