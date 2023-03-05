import * as SQLite from 'expo-sqlite';
import { showToast } from '../../hooks/showToast';
import { sourceManager } from '../../sources/sourceManager';
import { ChapterItem } from '../types';

import * as cheerio from 'cheerio';
import RNFetchBlob from 'rn-fetch-blob';
import { txnErrorCallback } from '@database/utils/helpers';

const db = SQLite.openDatabase('lnreader.db');

const insertChaptersQuery = `
INSERT INTO chapters (
  chapterUrl, chapterName, releaseDate, 
  novelId
) 
values 
  (?, ?, ?, ?)
`;

export const insertChapters = async (
  novelId: number,
  chapters?: ChapterItem[],
) => {
  if (!chapters?.length) {
    return;
  }

  db.transaction(tx => {
    chapters.map(chapter =>
      tx.executeSql(insertChaptersQuery, [
        chapter.chapterUrl,
        chapter.chapterName,
        chapter.releaseDate,
        novelId,
      ]),
    );
  });
};

const getChaptersQuery = (sort = 'ORDER BY chapterId ASC', filter = '') =>
  `SELECT * FROM chapters WHERE novelId = ? ${filter} ${sort}`;

export const getChapters = (novelId: number, sort: string, filter: string) => {
  return new Promise(resolve =>
    db.transaction(tx => {
      tx.executeSql(
        getChaptersQuery(sort, filter),
        [novelId],
        (txObj, { rows }) => {
          const _array = (rows as any)._array;
          resolve(_array);
        },
        txnErrorCallback,
      );
    }),
  );
};

const getChapterQuery = 'SELECT * FROM downloads WHERE downloadChapterId = ?';

export const getChapterFromDB = async (chapterId: number) => {
  return new Promise(resolve =>
    db.transaction(tx => {
      tx.executeSql(
        getChapterQuery,
        [chapterId],
        (txObj, results) => {
          resolve(results.rows.item(0));
        },
        (_txObj, _error) => {
          // console.log('Error ', error)
          return false;
        },
      );
    }),
  );
};

const getPrevChapterQuery = `
  SELECT
    *
  FROM
    chapters
  WHERE
    novelId = ?
  AND
    chapterId < ?
  `;

export const getPrevChapter = (
  novelId: number,
  chapterId: number,
): Promise<ChapterItem> => {
  return new Promise(resolve =>
    db.transaction(tx => {
      tx.executeSql(
        getPrevChapterQuery,
        [novelId, chapterId],
        (_txObj, results) =>
          resolve(results.rows.item(results.rows.length - 1)),
        (_txObj, error) => {
          showToast(error.message);
          return false;
        },
      );
    }),
  );
};

const getNextChapterQuery = `
  SELECT
    *
  FROM
    chapters
  WHERE
    novelId = ?
  AND
  chapterId > ?
  `;

export const getNextChapter = (
  novelId: number,
  chapterId: number,
): Promise<ChapterItem> => {
  return new Promise(resolve =>
    db.transaction(tx => {
      tx.executeSql(
        getNextChapterQuery,
        [novelId, chapterId],
        (_txObj, results) => resolve(results.rows.item(0)),
        (_txObj, error) => {
          showToast(error.message);
          return false;
        },
      );
    }),
  );
};

const markChapterReadQuery =
  'UPDATE chapters SET `read` = 1 WHERE chapterId = ?';

export const markChapterRead = async (chapterId: number) => {
  db.transaction(tx => {
    tx.executeSql(
      markChapterReadQuery,
      [chapterId],
      (_txObj, _res) => {},
      (_txObj, _error) => {
        // console.log(error)
        return false;
      },
    );
  });
};

const markChapterUnreadQuery =
  'UPDATE chapters SET `read` = 0 WHERE chapterId = ?';

export const markChapterUnread = async (chapterId: number) => {
  db.transaction(tx => {
    tx.executeSql(
      markChapterUnreadQuery,
      [chapterId],
      (_txObj, _res) => {},
      (_txObj, _error) => {
        // console.log(error)
        return false;
      },
    );
  });
};

const markAllChaptersReadQuery =
  'UPDATE chapters SET `read` = 1 WHERE novelId = ?';

export const markAllChaptersRead = async (novelId: number) => {
  db.transaction(tx => {
    tx.executeSql(
      markAllChaptersReadQuery,
      [novelId],
      (_txObj, _res) => {},
      (_txObj, _error) => {
        // console.log(error)
        return false;
      },
    );
  });
};

const markAllChaptersUnreadQuery =
  'UPDATE chapters SET `read` = 0 WHERE novelId = ?';

export const markAllChaptersUnread = async (novelId: number) => {
  db.transaction(tx => {
    tx.executeSql(
      markAllChaptersUnreadQuery,
      [novelId],
      (_txObj, _res) => {},
      (_txObj, _error) => {
        // console.log(error)
        return false;
      },
    );
  });
};

const isChapterDownloadedQuery =
  'SELECT * FROM downloads WHERE downloadChapterId=?';

export const isChapterDownloaded = async (chapterId: number) => {
  return new Promise(resolve =>
    db.transaction(tx => {
      tx.executeSql(
        isChapterDownloadedQuery,
        [chapterId],
        (txObj, res) => {
          if (res.rows.length !== 0) {
            resolve(true);
          } else {
            resolve(false);
          }
        },
        (_txObj, _error) => {
          // console.log('Error ', error)
          return false;
        },
      );
    }),
  );
};

const downloadChapterQuery =
  'INSERT INTO downloads (downloadChapterId, chapterName, chapterText) VALUES (?, ?, ?)';

const createImageFolder = async (
  path: string,
  data?: {
    sourceId: number;
    novelId: number;
    chapterId: number;
  },
): Promise<string> => {
  const mkdirIfNot = async (p: string) => {
    const nomediaPath =
      p + (p.charAt(p.length - 1) === '/' ? '' : '/') + '.nomedia';
    if (!(await RNFetchBlob.fs.exists(p))) {
      await RNFetchBlob.fs.mkdir(p);
      await RNFetchBlob.fs.createFile(nomediaPath, ',', 'utf8');
    }
  };

  await mkdirIfNot(path);

  if (data) {
    const { sourceId, novelId, chapterId } = data;
    await mkdirIfNot(`${path}/${sourceId}/`);
    await mkdirIfNot(`${path}/${sourceId}/${novelId}/`);
    await mkdirIfNot(`${path}/${sourceId}/${novelId}/${chapterId}/`);
    return `${path}/${sourceId}/${novelId}/${chapterId}/`;
  } else {
    return path;
  }
};

const downloadImages = async (
  html: string,
  sourceId: number,
  novelId: number,
  chapterId: number,
): Promise<string> => {
  try {
    const headers = sourceManager(sourceId)?.headers || {};
    const loadedCheerio = cheerio.load(html);
    const imgs = loadedCheerio('img').toArray();
    for (let i = 0; i < imgs.length; i++) {
      const elem = loadedCheerio(imgs[i]);
      const url = elem.attr('src');
      if (url) {
        const imageb64 = (
          await RNFetchBlob.fetch('GET', url, headers)
        ).base64();
        const fileurl =
          (await createImageFolder(
            `${RNFetchBlob.fs.dirs.DownloadDir}/LNReader`,
            { sourceId, novelId, chapterId },
          ).catch(() => {
            showToast(
              `Unexpected storage error!\nRemove ${fileurl} and try downloading again`,
            );
            return '--';
          })) +
          i +
          '.b64.png';
        if (fileurl.charAt(0) === '-') {
          return loadedCheerio.html();
        }
        elem.attr('src', `file://${fileurl}`);
        const exists = await RNFetchBlob.fs.exists(fileurl).catch(() => {
          showToast(
            `Unexpected storage error!\nRemove ${fileurl} and try downloading again`,
          );
        });
        if (!exists) {
          RNFetchBlob.fs.createFile(fileurl, imageb64, 'base64').catch(() => {
            showToast(
              `Unexpected storage error!\nRemove ${fileurl} and try downloading again`,
            );
          });
        } else {
          RNFetchBlob.fs.writeFile(fileurl, imageb64, 'base64').catch(() => {
            showToast(
              `Unexpected storage error!\nRemove ${fileurl} and try downloading again`,
            );
          });
        }
      }
    }
    loadedCheerio('body').prepend("<input type='hidden' offline />");
    return loadedCheerio.html();
  } catch (e) {
    return html;
  }
};

export const downloadChapter = async (
  sourceId: number,
  novelUrl: string,
  novelId: number,
  chapterUrl: string,
  chapterId: number,
) => {
  try {
    const source = sourceManager(sourceId);

    const chapter = await source.parseChapter(novelUrl, chapterUrl);

    if (chapter.chapterText?.length) {
      const imagedChapterText =
        chapter.chapterText &&
        (await downloadImages(
          chapter.chapterText,
          sourceId,
          novelId,
          chapterId,
        ));

      db.transaction(tx => {
        tx.executeSql(
          'UPDATE chapters SET downloaded = 1 WHERE chapterId = ?',
          [chapterId],
        );
        tx.executeSql(
          downloadChapterQuery,
          [chapterId, chapter.chapterName, imagedChapterText],
          (_txObj, _res) => {
            return true;
          },
          txnErrorCallback,
        );
      });
    } else {
      throw new Error("Either chapter is empty or the app couldn't scrape it");
    }
  } catch (error) {
    throw error;
  }
};

const deleteDownloadedImages = async (
  sourceId: number,
  novelId: number,
  chapterId: number,
) => {
  try {
    const path = await createImageFolder(
      `${RNFetchBlob.fs.dirs.DownloadDir}/LNReader`,
      { sourceId, novelId, chapterId },
    );
    const files = await RNFetchBlob.fs.ls(path);
    for (let i = 0; i < files.length; i++) {
      const ex = /\.b64\.png/.exec(files[i]);
      if (ex) {
        if (await RNFetchBlob.fs.exists(`${path}${files[i]}`)) {
          RNFetchBlob.fs.unlink(`${path}${files[i]}`);
        }
      }
    }
  } catch (error) {}
};

export const deleteChapter = async (
  sourceId: number,
  novelId: number,
  chapterId: number,
) => {
  const updateIsDownloadedQuery =
    'UPDATE chapters SET downloaded = 0 WHERE chapterId=?';
  const deleteChapterQuery = 'DELETE FROM downloads WHERE downloadChapterId=?';

  await deleteDownloadedImages(sourceId, novelId, chapterId);

  db.transaction(tx => {
    tx.executeSql(
      updateIsDownloadedQuery,
      [chapterId],
      (_txObj, _res) => {},
      (_txObj, _error) => {
        // console.log('Error ', error)
        return false;
      },
    );
    tx.executeSql(
      deleteChapterQuery,
      [chapterId],
      (_txObj, _res) => {
        // console.log('Chapter deleted');
      },
      (_txObj, _error) => {
        // console.log('Error ', error)
        return false;
      },
    );
  });
};

export const deleteChapters = async (
  sourceId: number,
  chapters?: ChapterItem[],
) => {
  if (!chapters?.length) {
    return;
  }

  const chapterIdsString = chapters
    ?.map(chapter => chapter.chapterId)
    .toString();

  const updateIsDownloadedQuery = `UPDATE chapters SET downloaded = 0 WHERE chapterId IN (${chapterIdsString})`;
  const deleteChapterQuery = `DELETE FROM downloads WHERE downloadChapterId IN (${chapterIdsString})`;

  await Promise.all(
    chapters?.map(chapter =>
      deleteDownloadedImages(sourceId, chapter.novelId, chapter.chapterId),
    ),
  );

  db.transaction(tx => {
    tx.executeSql(
      updateIsDownloadedQuery,
      undefined,
      undefined,
      txnErrorCallback,
    );
    tx.executeSql(deleteChapterQuery, undefined, undefined, txnErrorCallback);
  });
};

const getLastReadChapterQuery = `
    SELECT chapters.*
    FROM history
    JOIN chapters
    ON history.historyChapterId = chapters.chapterId
    WHERE history.historyNovelId = ?
`;

export const getLastReadChapter = async (novelId: number) => {
  return new Promise(resolve => {
    db.transaction(tx => {
      tx.executeSql(
        getLastReadChapterQuery,
        [novelId],
        (txObj, { rows }) => resolve(rows.item(0)),
        (_txObj, _error) => {
          // console.log('Error ', error)
          return false;
        },
      );
    });
  });
};

const bookmarkChapterQuery =
  'UPDATE chapters SET bookmark = ? WHERE chapterId = ?';

export const bookmarkChapter = async (bookmark: boolean, chapterId: number) => {
  db.transaction(tx => {
    tx.executeSql(
      bookmarkChapterQuery,
      [!bookmark, chapterId],
      (_txObj, _res) => {},
      (_txObj, _error) => {
        // console.log('Error ', error)
        return false;
      },
    );
  });
};

const markPreviuschaptersReadQuery =
  'UPDATE chapters SET `read` = 1 WHERE chapterId < ? AND novelId = ?';

export const markPreviuschaptersRead = async (
  chapterId: number,
  novelId: number,
) => {
  db.transaction(tx => {
    tx.executeSql(
      markPreviuschaptersReadQuery,
      [chapterId, novelId],
      (_txObj, _res) => {},
      (_txObj, _error) => {
        // console.log(error)
        return false;
      },
    );
  });
};

const markPreviousChaptersUnreadQuery =
  'UPDATE chapters SET `read` = 0 WHERE chapterId < ? AND novelId = ?';

export const markPreviousChaptersUnread = async (
  chapterId: number,
  novelId: number,
) => {
  db.transaction(tx => {
    tx.executeSql(
      markPreviousChaptersUnreadQuery,
      [chapterId, novelId],
      (_txObj, _res) => {},
      (_txObj, _error) => {
        // console.log(error)
        return false;
      },
    );
  });
};

const getDownloadedChaptersQuery = `
    SELECT chapters.*, novels.sourceId, novels.novelName, novels.novelCover, novels.novelUrl
    FROM chapters
    JOIN novels
    ON chapters.novelId = novels.novelId
    WHERE chapters.downloaded = 1`;

export const getDownloadedChapters = () => {
  return new Promise(resolve =>
    db.transaction(tx => {
      tx.executeSql(
        getDownloadedChaptersQuery,
        undefined,
        (txObj, { rows }) => {
          const _array = (rows as any)._array;
          resolve(_array);
        },
        (_txObj, _error) => {
          // console.log('Error ', error)
          return false;
        },
      );
    }),
  );
};

export const deleteDownloads = async () => {
  db.transaction(tx => {
    tx.executeSql('UPDATE chapters SET downloaded = 0');
    tx.executeSql('DELETE FROM downloads; VACCUM;');
  });
};

export const updateChapterDownloadedQuery = `
  UPDATE 
    chapters 
  SET 
    downloaded = 1
  WHERE 
    chapterId = ?`;

export const updateChapterDeletedQuery = `
  UPDATE 
    chapters 
  SET 
    downloaded = 0
  WHERE 
    chapterId = ?`;
