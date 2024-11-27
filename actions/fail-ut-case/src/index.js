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

function insert(conn,action_time,ut_name,pr_link,action_link,job_time) {
    const sql = "INSERT INTO `ut` (`action_time`,`ut_name`,`pr_link`,`action_link`,`job_time`) VALUES (?,?,?,?,?)";
    const values = [action_time, ut_name, pr_link, action_link, job_time];
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


async function main() {
    let conn;
    try {
        const action_time = core.getInput('action_time');
        const job_time = core.getInput('job_time');
        const pr_link = core.getInput('pr_link');
        const action_link = core.getInput('action_link');
        const ut_cases = core.getInput('ut_cases');
        const moHost = core.getInput('mo_host');
        const moPort = parseInt(core.getInput('mo_port'));
        const moUser = core.getInput('mo_user');
        const moPassword = core.getInput('mo_password');
        const moDatabase = core.getInput('mo_database');

        conn = await initMysqlConnection(moHost, moPort, moUser, moPassword, moDatabase);
        logger.info('Initialized MOC connection successfully.');

        case_list=ut_cases.split(',')
        for (let i = 0; i < case_list.length; i++) {
            if (case_list[i] === ''){
                continue
            }
            const case_name=case_list[i]
            await insert(conn,action_time,case_name,pr_link,action_link,job_time)
        }
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