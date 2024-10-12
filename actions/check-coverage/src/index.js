const core = require('@actions/core');
const mysql = require('mysql');
const fs = require('fs');
const winston = require('winston');

function setupLogging() {
    const logLevel = core.getInput('log_level') || 'info';
    return winston.createLogger({
        level: logLevel,
        format: winston.format.combine(
            winston.format.timestamp(),
            winston.format.printf(info => `${info.timestamp} - ${info.level}: ${info.message}`)
        ),
        transports: [
            new winston.transports.Console()
        ]
    });
}
const logger = setupLogging();

async function initMysqlConnection(host, port, user, password, database) {
    const conn = mysql.createConnection({ host, port, user, password, database });
    return new Promise((resolve, reject) => {
        conn.connect(err => {
            if (err) {
                logger.error(`Error connecting to MySQL: ${err}`);
                return reject(err);
            }
            resolve(conn);
        });
    });
}

function insert(conn, commitId,branch, utCoverage, bvtCoverage, status) {
    const sql = "INSERT INTO `coverage` (`commit_id`,`branch`, `ut_coverage`, `bvt_coverage`, `status`) VALUES (?, ?, ?, ?, ?)";
    const values = [commitId,branch, utCoverage, bvtCoverage, status];
    return new Promise((resolve, reject) => {
        conn.query(sql, values, (err, results) => {
            if (err) {
                logger.error(`Insert failed, err: ${err}`);
                return reject(err);
            }
            resolve(results);
        });
    });
}

function update(conn, commitId, utCoverage, bvtCoverage) {
    const sql = "UPDATE `coverage` SET `ut_coverage` = ?, `bvt_coverage` = ? WHERE `commit_id` = ?";
    const values = [utCoverage, bvtCoverage, commitId];
    return new Promise((resolve, reject) => {
        conn.query(sql, values, (err, results) => {
            if (err) {
                logger.error(`Update coverage failed, err: ${err}`);
                return reject(err);
            }
            resolve(results);
        });
    });
}

async function updateStatus(conn, prNumber, status) {
    const sql = "UPDATE `coverage` SET `status` = ? WHERE `commit_id` = ?";
    const values = [status, prNumber];
    return new Promise((resolve, reject) => {
        conn.query(sql, values, (err, results) => {
            if (err) {
                logger.error(`Update status failed, err: ${err}`);
                return reject(err);
            }
            resolve(results);
        });
    });
}

async function get(conn, prNumber) {
    const sql = "SELECT * FROM `coverage` WHERE `pr_number` = ? AND status = 1";
    return new Promise((resolve, reject) => {
        conn.query(sql, [prNumber], (err, results) => {
            if (err) {
                logger.error(`Get coverage failed, err: ${err}`);
                return reject(err);
            }
            resolve(results);
        });
    });
}

async function exists(conn, commitId) {
    const sql = "SELECT * FROM `coverage` WHERE `commit_id` = ?";
    return new Promise((resolve, reject) => {
        conn.query(sql, [commitId], (err, results) => {
            if (err) {
                logger.error(`Check existence failed, err: ${err}`);
                return reject(err);
            }
            // logger.info(results);
            resolve(results.length > 0);
        });
    });
}

async function getLatest(conn,branch) {
    const sql = "SELECT * FROM `coverage` WHERE `status` = 0 AND `branch` = ? ORDER BY `update_time` DESC LIMIT 1";
    return new Promise((resolve, reject) => {
        conn.query(sql, [branch],(err, results) => {
            if (err) {
                logger.error(`Get latest merged PR info failed, err: ${err}`);
                return reject(err);
            }
            // logger.info(`Latest PR result: ${results}`);
            resolve(results);
        });
    });
}

async function updateData(connection, commitId,branch, utCoverage, bvtCoverage) {
    if (await exists(connection, commitId)) {
        await update(connection, commitId, utCoverage, bvtCoverage);
        logger.info(`This PR already exists, just update coverage. commitId: ${commitId}`);
    } else {
        await insert(connection, commitId,branch, utCoverage, bvtCoverage, 1);
        logger.info(`This PR is new, insert coverage. commitId: ${commitId}`);
    }
}

function parseCoverage(file) {
    let coverage = 0;
    try {
        logger.info(`Parsing coverage file: ${file}`);
        const data = fs.readFileSync(file, 'utf8');
        const lines = data.split('\n').filter(line => line && !line.startsWith('mode:'));
        const totalCount = lines.length;
        const executedCount = lines.reduce((count, line) => {
            const executed = parseInt(line.split(' ')[2]);
            return count + (executed > 0 ? 1 : 0);
        }, 0);
        coverage = (executedCount / totalCount) * 100;
    } catch (error) {
        logger.error(`Error reading coverage file ${file}: ${error}`);
        throw error;
    }
    return coverage;
}

async function main() {
    let conn;
    try {
        const type = core.getInput('type');
        const utCoverageFile = core.getInput('ut_coverage_file');
        const bvtCoverageFile = core.getInput('bvt_coverage_file');
        const commitId = core.getInput('commit_id');
        const branch = core.getInput('branch');
        const moHost = core.getInput('mo_host');
        const moPort = parseInt(core.getInput('mo_port'));
        const moUser = core.getInput('mo_user');
        const moPassword = core.getInput('mo_password');
        const moDatabase = core.getInput('mo_database');

        conn = await initMysqlConnection(moHost, moPort, moUser, moPassword, moDatabase);
        logger.info('Initialized MOC connection successfully.');

        if (type === 'merged') {
            if (await exists(conn, commitId)) {
                await updateStatus(conn, commitId, '0');
                logger.info(`${commitId} has been merged. Just update status to 0 in database.`);
                return;
            } else {
                logger.warn(`This commit ${commitId} doesn't exist in the database.`);
                core.setFailed(`Commit ${commitId} not found in the database.`);
                return;
            }
        } else if (type !== 'open') {
            logger.error(`Invalid type: ${type}`);
            core.setFailed(`Invalid type: ${type}`);
            return;
        }

        const currentUtCoverage = parseCoverage(utCoverageFile);
        const currentBvtCoverage = parseCoverage(bvtCoverageFile);
        logger.info(`Current UT coverage: ${currentUtCoverage}%, Current BVT coverage: ${currentBvtCoverage}%`);

        const latestPrData = await getLatest(conn,branch);
        if (!latestPrData || latestPrData.length === 0) {
            logger.error(`No latest merged PR data found in the database.`);
            core.setFailed(`No latest merged PR data found.`);
            return;
        }

        const mainUtCoverage = latestPrData[0].ut_coverage;
        const mainBvtCoverage = latestPrData[0].bvt_coverage;
        logger.info(`Latest PR info: ${JSON.stringify(latestPrData[0])}`);

        if (currentUtCoverage < mainUtCoverage || currentBvtCoverage < mainBvtCoverage) {
            logger.warn(`Current UT coverage: ${currentUtCoverage}%, Current BVT coverage: ${currentBvtCoverage}%`);
            logger.warn(`Main branch UT coverage: ${mainUtCoverage}%, Main branch BVT coverage: ${mainBvtCoverage}%`);
            logger.error(`The coverage is lower than the main branch coverage, please check it.`);
            core.setFailed(`Coverage below main branch: UT ${currentUtCoverage}% < ${mainUtCoverage}%, BVT ${currentBvtCoverage}% < ${mainBvtCoverage}%`);
            return;
        }
        logger.info("Current coverage is above or equal to main branch coverage, will insert or update this PR info.");
        await updateData(conn, commitId, branch, currentUtCoverage, currentBvtCoverage);
    } catch (error) {
        logger.error(`Error in main function: ${error}`);
        core.setFailed(`Error in main function: ${error.message}`);
    } finally {
        if (conn && conn.end) {
            conn.end(err => {
                if (err) {
                    logger.error(`Error closing MySQL connection: ${err}`);
                } else {
                    logger.info('MOC connection closed.');
                }
            });
        }
    }
}

main();