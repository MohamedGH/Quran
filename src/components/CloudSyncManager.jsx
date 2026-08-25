import { useEffect, useRef, useCallback } from "react";
import { useSelector, useDispatch, shallowEqual } from "react-redux";
import { doc, getDoc, setDoc, onSnapshot } from "firebase/firestore";
import { firebaseDb } from "../services/firebase";
import { sel, setLDataThunk, goalsActions, collectionsActions, uiActions, quranActions, playerActions } from "../store";
import { addSyncLog } from "./SyncConsole";
import { getDeviceId } from "./ExportImport";

export default function CloudSyncManager({ uid }) {
  const dispatch = useDispatch();

  const learnData       = useSelector(sel.learnData);
  const collections     = useSelector(sel.collections);
  const activity        = useSelector(sel.activity);
  const goals           = useSelector(sel.goals);
  const loopBySurah     = useSelector(sel.loopBySurah);
  const lastAyatBySurah = useSelector(sel.lastAyatBySurah, shallowEqual);
  const revisionMastery = useSelector(sel.revisionMastery);

  const isInitialPullDone = useRef(false);
  const saveTimerRef      = useRef(null);

  const pullFromCloud = useCallback(async () => {
    if (!uid || uid === "demo-user") return;
    try {
      addSyncLog("info", "Lecture données cloud...");
      const docRef = doc(firebaseDb, "users", uid);
      const snap   = await getDoc(docRef);

      if (snap.exists()) {
        const cloudData = snap.data();
        addSyncLog("ok", `Données reçues (${Object.keys(cloudData.learnData || {}).length} sourates)`);

        if (cloudData.learnData) {
          Object.entries(cloudData.learnData).forEach(([key, data]) => {
            if (key.includes(":")) {
              const [sn, an] = key.split(":").map(Number);
              if (!isNaN(sn) && !isNaN(an) && data) {
                dispatch(setLDataThunk(sn, an, () => data));
              }
            } else if (data && typeof data === "object") {
              Object.entries(data).forEach(([an, item]) => {
                const snNum = Number(key);
                const anNum = Number(an);
                if (!isNaN(snNum) && !isNaN(anNum) && item) {
                  dispatch(setLDataThunk(snNum, anNum, () => item));
                }
              });
            }
          });
        }
        if (cloudData.collections) {
          dispatch(collectionsActions.setCollections(cloudData.collections));
        }
        if (cloudData.goals) {
          dispatch(goalsActions.setGoals(cloudData.goals));
        }
        if (cloudData.activity) {
          dispatch(goalsActions.setActivity(cloudData.activity));
        }
        if (cloudData.loopBySurah) {
          dispatch(playerActions.setLoopBySurahAll?.(cloudData.loopBySurah));
        }
        if (cloudData.lastAyatBySurah) {
          Object.entries(cloudData.lastAyatBySurah).forEach(([sn, an]) => {
              dispatch(quranActions.setLastAyatForSurah({ surahNum: Number(sn), ayatNum: Number(an) }));
          });
        }
        if (cloudData.revisionMastery) {
          dispatch(uiActions.setRevisionMasteryAll?.(cloudData.revisionMastery));
        }
      } else {
        addSyncLog("info", "Aucune donnée distante, création du document cloud");
      }
    } catch (err) {
      console.error("[CloudSyncPull]", err);
      addSyncLog("err", `Erreur pull: ${err.message}`);
    } finally {
      isInitialPullDone.current = true;
    }
  }, [uid, dispatch]);

  const pushToCloud = useCallback(async () => {
    if (!uid || uid === "demo-user" || !isInitialPullDone.current) return;
    try {
      addSyncLog("info", "Sauvegarde automatique dans le cloud...");
      const docRef = doc(firebaseDb, "users", uid);
      const myId = getDeviceId();
      const payload = {
        updatedAt: new Date().toISOString(),
        deviceId: myId,
        learnData: learnData || {},
        collections: collections || [],
        activity: activity || {},
        goals: goals || {},
        loopBySurah: loopBySurah || {},
        lastAyatBySurah: lastAyatBySurah || {},
        revisionMastery: revisionMastery || {},
      };
      await setDoc(docRef, payload, { merge: true });
      addSyncLog("ok", "Sauvegarde cloud réussie");
    } catch (err) {
      console.error("[CloudSyncPush]", err);
      addSyncLog("err", `Erreur push: ${err.message}`);
    }
  }, [uid, learnData, collections, activity, goals, loopBySurah, lastAyatBySurah, revisionMastery]);

  useEffect(() => {
    if (!uid || uid === "demo-user") return;
    pullFromCloud();
  }, [uid, pullFromCloud]);

  useEffect(() => {
    if (!uid || uid === "demo-user") return;
    const docRef = doc(firebaseDb, "users", uid);
    const unsub = onSnapshot(
      docRef,
      (snap) => {
        if (snap.exists()) {
          const d = snap.data();
          if (d.deviceId && d.deviceId !== getDeviceId() && isInitialPullDone.current) {
            addSyncLog("info", `Mise à jour distante détectée (${d.deviceId}) — fusion...`);
            if (d.learnData) {
              Object.entries(d.learnData).forEach(([key, data]) => {
                if (key.includes(":")) {
                  const [sn, an] = key.split(":").map(Number);
                  if (!isNaN(sn) && !isNaN(an) && data) {
                    dispatch(setLDataThunk(sn, an, () => data));
                  }
                } else if (data && typeof data === "object") {
                  Object.entries(data).forEach(([an, item]) => {
                    const snNum = Number(key);
                    const anNum = Number(an);
                    if (!isNaN(snNum) && !isNaN(anNum) && item) {
                      dispatch(setLDataThunk(snNum, anNum, () => item));
                    }
                  });
                }
              });
            }
            if (d.collections) dispatch(collectionsActions.setCollections(d.collections));
          }
        }
      },
      (err) => {
        addSyncLog("err", `Snapshot listener disabled: ${err.message}`);
      }
    );
    return unsub;
  }, [uid, dispatch]);

  useEffect(() => {
    if (!uid || !isInitialPullDone.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(pushToCloud, 4000);
    return () => clearTimeout(saveTimerRef.current);
  }, [uid, learnData, collections, activity, goals, loopBySurah, lastAyatBySurah, revisionMastery, pushToCloud]);

  return null;
}
