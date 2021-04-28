import { existsSync, promises as fs } from 'fs';
import { forEach, groupBy, isUndefined, map, uniq } from 'lodash';
import * as path from 'path';
import { ExportSpecifier, Node, Project as TsProject } from 'ts-morph';

const basePath = path.resolve('../ngxp-demo/');

run();

async function run() {
    const tsProject = new TsProject({
        tsConfigFilePath: path.join(basePath, 'tsconfig.json')
    });

    const workspace = await readWorkspace(path.join(basePath, 'angular.json'));

    getProjects(workspace)
        .map(getTsConfigPath)
        .filter(tsConfigPath => existsSync(tsConfigPath))
        .forEach(tsConfigPath => tsProject.addSourceFilesFromTsConfig(tsConfigPath));

    const symbols = getLibraryBarrelFilePaths(workspace)
        .map(barrelFilePath => tsProject.getSourceFile(barrelFilePath)!)
        .filter(file => !isUndefined(file))
        .flatMap(file => file.getExportSymbols().map(symbol => ({
            project: getProjectName(workspace, file.getFilePath()),
            symbol: symbol.getName(),
            referencingProjects: uniq(symbol.getDeclarations()
                .flatMap(declaration => {
                    if (declaration instanceof ExportSpecifier) {
                        return declaration.getSymbol()!.getAliasedSymbol()!.getDeclarations()
                    } else {
                        return [declaration];
                    }
                })
                .flatMap(declaration => {
                    if (!Node.isReferenceFindableNode(declaration)) {
                        return [];
                    }

                    return declaration.findReferencesAsNodes()
                        .map(node => getProjectName(workspace, node.getSourceFile().getFilePath()))
                }))
                .filter(project => project !== getProjectName(workspace, file.getFilePath()))
        })));

    forEach(
        groupBy(symbols, 'project'),
        (symbols, project) => console.log(`${project}:\n${symbols.map(({ symbol, referencingProjects }) => `   ${symbol} (${referencingProjects.join(', ')})`).join('\n')}`)
    )

}

interface Workspace {
    projects: {
        [key: string]: ProjectDeclaration
    }
}

interface ProjectDeclaration {
    root: string;
    sourceRoot: string;
    projectType: ProjectType;
}

interface Project extends ProjectDeclaration {
    name: string;
}

enum ProjectType {
    Application = 'application',
    Library = 'library'
}

async function readWorkspace(path: string): Promise<Workspace> {
    return JSON.parse(await fs.readFile(path, 'utf-8'));
}

function getProjectName(workspace: Workspace, filePath: string) {
    const matchingProject = getProjects(workspace)
        .find(project => toRelativePath(filePath).startsWith(project.sourceRoot))

    if (isUndefined(matchingProject)) {
        throw Error(`Cannot find library for file ${filePath}.`)
    }

    return matchingProject.name;
}

function getLibraryBarrelFilePaths(workspace: Workspace) {
    return getLibraries(workspace)
        .map(library => path.join(basePath, library.sourceRoot, 'index.ts'));
}

function getLibraries(workspace: Workspace): Project[] {
    return getProjects(workspace)
        .filter(project => project.projectType === ProjectType.Library)
}

function getProjects(workspace: Workspace): Project[] {
    return map(workspace.projects, (project, name) => ({
        name,
        ...project
    }))
}

function getTsConfigPath({ projectType, root }: Project) {
    const fileNameMapping = {
        [ProjectType.Application]: 'tsconfig.app.json',
        [ProjectType.Library]: 'tsconfig.lib.json'
    }

    return path.join(basePath, root, fileNameMapping[projectType])
}

function toRelativePath(filePath: string) {
    return path.relative(basePath, filePath).replace(/\\/g, '/');
}
